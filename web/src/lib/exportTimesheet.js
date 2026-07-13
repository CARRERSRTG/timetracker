// Timesheet exporters. Both are dynamically imported by the Reports view so the
// heavy ExcelJS dependency never lands in the initial bundle — it loads only when
// the manager actually clicks Export.
//
// Data shape (built in ManagerReports.buildExportData):
// {
//   periodLabel, generatedAt, currencySymbol,
//   company: { name, address, taxId, phone, email },
//   employees: [{ name, email, statusLabel,
//     lines: [{ project, location, hours, reg, ot, pay }],
//     adjustments: [{ label, amount }],
//     totalHours, totalPay }],
//   grandHours, grandPay
// }

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ---- Excel (.xlsx) — styled, with a collapsible row group per employee ----
export async function exportExcel(data, filename) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default || mod;
  const sym = data.currencySymbol || '$';
  const money = `"${sym}"#,##0.00`;
  const wb = new ExcelJS.Workbook();
  wb.creator = data.company?.name || 'Time Tracker';

  const ws = wb.addWorksheet('Timesheet', {
    properties: { outlineLevelRow: 1 },
    // employee summary row sits ABOVE its collapsible detail rows
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  const widths = [36, 18, 10, 10, 10, 15];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const NAVY = 'FF16233A', LIGHT = 'FFEFF3FA', LINE = 'FFCBD5E6';
  const border = { style: 'thin', color: { argb: LINE } };
  const allBorders = { top: border, left: border, bottom: border, right: border };

  // Title
  ws.mergeCells('A1:F1');
  const title = ws.getCell('A1');
  title.value = data.company?.name || 'Timesheet';
  title.font = { bold: true, size: 16 };
  ws.mergeCells('A2:F2');
  const sub = ws.getCell('A2');
  sub.value = [data.company?.address, data.company?.phone, data.company?.email].filter(Boolean).join('   ·   ');
  sub.font = { size: 10, color: { argb: 'FF6B7A90' } };
  ws.mergeCells('A3:F3');
  const per = ws.getCell('A3');
  per.value = `Timesheet — ${data.periodLabel}${data.generatedAt ? '   ·   generated ' + data.generatedAt : ''}`;
  per.font = { size: 11, italic: true };

  // Header row (row 5)
  const headers = ['Employee / Project', 'Location', 'Hours', 'Regular', 'OT', 'Pay'];
  const hr = ws.getRow(5);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { vertical: 'middle', horizontal: i >= 2 ? 'right' : 'left' };
    c.border = allBorders;
  });
  hr.height = 20;

  let r = 6;
  data.employees.forEach((emp) => {
    // employee summary row (level 0) — bold, light fill
    const sr = ws.getRow(r++);
    sr.getCell(1).value = emp.name + (emp.email ? `  <${emp.email}>` : '') + (emp.statusLabel ? `  [${emp.statusLabel}]` : '');
    sr.getCell(3).value = round2(emp.totalHours);
    sr.getCell(6).value = round2(emp.totalPay);
    for (let i = 1; i <= 6; i++) {
      const c = sr.getCell(i);
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      c.border = allBorders;
      if (i >= 3) c.alignment = { horizontal: 'right' };
    }
    sr.getCell(3).numFmt = '0.00';
    sr.getCell(6).numFmt = money;

    const detail = (cells, opts = {}) => {
      const row = ws.getRow(r++);
      row.outlineLevel = 1;
      cells.forEach((v, i) => {
        const c = row.getCell(i + 1);
        if (v !== null && v !== undefined && v !== '') c.value = v;
        c.border = allBorders;
        if (i >= 2) { c.alignment = { horizontal: 'right' }; c.numFmt = i === 5 ? money : '0.00'; }
        if (opts.muted) c.font = { color: { argb: 'FF6B7A90' } };
      });
      return row;
    };

    emp.lines.forEach((l) => detail([
      '   ' + l.project, l.location || '', round2(l.hours), round2(l.reg), round2(l.ot), round2(l.pay),
    ]));
    emp.adjustments.forEach((ad) => {
      const row = detail(['   ' + (Number(ad.amount) < 0 ? '➖ ' : '➕ ') + ad.label, '', '', '', '', round2(ad.amount)], { muted: true });
      row.getCell(6).numFmt = money;
    });
  });

  // Grand total
  const gr = ws.getRow(r + 1);
  gr.getCell(1).value = 'TEAM TOTAL';
  gr.getCell(3).value = round2(data.grandHours);
  gr.getCell(6).value = round2(data.grandPay);
  for (let i = 1; i <= 6; i++) {
    const c = gr.getCell(i);
    c.font = { bold: true, size: 12 };
    c.border = { top: { style: 'double', color: { argb: NAVY } } };
    if (i >= 3) c.alignment = { horizontal: 'right' };
  }
  gr.getCell(3).numFmt = '0.00';
  gr.getCell(6).numFmt = money;

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ---- PDF via the browser's print-to-PDF (no extra dependency) ----
export function exportPDF(data) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  const sym = data.currencySymbol || '$';
  const m = (n) => sym + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  const h = (n) => (Number(n) || 0).toFixed(2);

  const empBlocks = data.employees.map((emp) => `
    <div class="emp">
      <div class="emp-h">
        <span>${esc(emp.name)}${emp.email ? ` <span class="muted">&lt;${esc(emp.email)}&gt;</span>` : ''}${emp.statusLabel ? ` <span class="tag">${esc(emp.statusLabel)}</span>` : ''}</span>
        <span>${h(emp.totalHours)} h · <b>${m(emp.totalPay)}</b></span>
      </div>
      <table>
        <thead><tr><th>Project</th><th>Location</th><th class="r">Hours</th><th class="r">Regular</th><th class="r">OT</th><th class="r">Pay</th></tr></thead>
        <tbody>
          ${emp.lines.map((l) => `<tr><td>${esc(l.project)}</td><td>${esc(l.location || '—')}</td><td class="r">${h(l.hours)}</td><td class="r">${h(l.reg)}</td><td class="r">${h(l.ot)}</td><td class="r">${m(l.pay)}</td></tr>`).join('')}
          ${emp.adjustments.map((ad) => `<tr class="muted"><td colspan="5">${Number(ad.amount) < 0 ? '➖' : '➕'} ${esc(ad.label)}</td><td class="r">${m(ad.amount)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Timesheet — ${esc(data.periodLabel)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:'Segoe UI',system-ui,Arial,sans-serif;color:#1a2230;margin:28px}
      h1{margin:0 0 2px;font-size:22px} .sub{color:#6b7a90;font-size:12px;margin-bottom:2px}
      .period{font-style:italic;margin:6px 0 18px}
      .emp{margin:0 0 18px;break-inside:avoid}
      .emp-h{display:flex;justify-content:space-between;align-items:baseline;font-weight:800;font-size:15px;
        padding:6px 8px;background:#eff3fa;border:1px solid #cbd5e6;border-radius:6px 6px 0 0}
      table{width:100%;border-collapse:collapse;font-size:12.5px}
      th,td{border:1px solid #cbd5e6;padding:5px 8px;text-align:left} th{background:#16233a;color:#fff}
      td.r,th.r{text-align:right;white-space:nowrap} .muted{color:#6b7a90}
      .tag{font-size:10px;background:#e5ecff;color:#334;padding:1px 6px;border-radius:8px;font-weight:600}
      .grand{margin-top:16px;text-align:right;font-size:16px;font-weight:800;border-top:3px double #16233a;padding-top:8px}
      @media print{body{margin:12px}}
    </style></head><body>
      <h1>${esc(data.company?.name || 'Timesheet')}</h1>
      ${data.company?.address || data.company?.phone || data.company?.email ? `<div class="sub">${[data.company?.address, data.company?.phone, data.company?.email].filter(Boolean).map(esc).join('  ·  ')}</div>` : ''}
      <div class="period">Timesheet — ${esc(data.periodLabel)}${data.generatedAt ? '  ·  generated ' + esc(data.generatedAt) : ''}</div>
      ${empBlocks || '<p class="muted">No time this period.</p>'}
      <div class="grand">Team total: ${h(data.grandHours)} h · ${m(data.grandPay)}</div>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to export the PDF.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  // give the new document a tick to render before invoking the print dialog
  setTimeout(() => { try { w.print(); } catch { /* user can print manually */ } }, 350);
}
