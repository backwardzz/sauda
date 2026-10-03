// SheetJS подгружается по требованию: он большой, а нужен только при импорте и экспорте.

export async function exportXlsx(filename: string, sheet: string, rows: Record<string, unknown>[]): Promise<void> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] ?? {});
  ws['!cols'] = headers.map((h) => ({
    wch: Math.min(60, Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[h] ?? '').length)) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export async function readXlsx(file: File): Promise<unknown[][]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
}
