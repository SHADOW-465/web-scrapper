"""Compare downloaded Excel/CSV/PDF contents with the same UI's JSON export."""
import csv, json, re, sys
from pathlib import Path
import openpyxl
from pypdf import PdfReader
import subprocess

folder = Path(sys.argv[1] if len(sys.argv)>1 else 'output/verified-2026-10-05')
compact = lambda value: re.sub(r'\s+', '', str(value or ''))
for name in ['quotes-customized', 'buchmesse-with-contacts-sample']:
    records=json.loads((folder / (name+'.json')).read_text(encoding='utf8'))
    fields=list(records[0])
    expected=[[str(row.get(field) or '') for field in fields] for row in records]
    ws=openpyxl.load_workbook(folder/(name+'.xlsx'),read_only=True).active
    sheet=list(ws.values)
    assert list(sheet[0])==fields
    assert [[str(v or '') for v in row]+['']*(len(fields)-len(row)) for row in sheet[1:]]==expected
    with (folder/(name+'.csv')).open(encoding='utf-8-sig',newline='') as f:
        csv_rows=list(csv.reader(f))
    assert csv_rows==[fields]+expected
    pdf=PdfReader(folder/(name+'.pdf'))
    text=compact(''.join(page.extract_text() for page in pdf.pages))
    for row in expected:
        for cell in row:
            assert compact(cell) in text, f'PDF missing content: {cell[:100]}'
    subprocess.run(['pdftoppm','-f','1','-singlefile','-scale-to','1500','-png',str(folder/(name+'.pdf')),str(folder/(name+'-pdf-preview'))],check=True)
    print(f'PASS {name}: {len(records)} rows, {len(fields)} selected columns, {len(pdf.pages)} PDF pages; Excel/CSV match JSON and every cell is present in PDF')

name='buchmesse-all-companies'
records=json.loads((folder/(name+'.json')).read_text(encoding='utf8'))
fields=list(records[0])
sheet=list(openpyxl.load_workbook(folder/(name+'.xlsx'),read_only=True).active.values)
assert list(sheet[0])==fields
expected=[[str(row.get(field) or '') for field in fields] for row in records]
actual=[[str(v or '') for v in row]+['']*(len(fields)-len(row)) for row in sheet[1:]]
assert actual==expected
assert len(records)==4130, f'Expected the 4,130 advertised during this scan; got {len(records)}'
assert len({row['Url'] for row in records})==len(records), 'Duplicate company identifiers'
print(f'PASS full company directory: {len(records)} unique companies, Excel exactly matches JSON')

books=json.loads((folder/'books-two-pages.json').read_text(encoding='utf8'))
assert len(books)==40
sample=json.loads((folder/'buchmesse-with-contacts-sample.json').read_text(encoding='utf8'))
people=sum(bool(row.get('Team member name')) for row in sample)
print(f'PASS books: {len(books)} rows across two pages; contact sample: {len(sample)} rows, {people} named contacts')
