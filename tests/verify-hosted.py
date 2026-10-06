"""Check the four files downloaded from the hosted UI against one another."""
import csv, json, re, sys
from pathlib import Path
import openpyxl
from pypdf import PdfReader

folder = Path(sys.argv[1])
base = sys.argv[2] if len(sys.argv) > 2 else 'hosted-books-fixed'
records = json.loads((folder / (base + '.json')).read_text(encoding='utf8'))
assert len(records) == 40, f'Expected two pages of 20 books, got {len(records)}'
assert all(row.get('Name') for row in records), 'Later-page item details are missing'
fields = list(records[0])
assert fields == ['Book', 'Price', 'Name'], fields
expected = [fields] + [[str(row.get(f) or '') for f in fields] for row in records]
actual = list(openpyxl.load_workbook(folder / (base + '.xlsx'), read_only=True).active.values)
assert [list(row) for row in actual] == expected
with (folder / (base + '.csv')).open(encoding='utf-8-sig', newline='') as stream:
    assert list(csv.reader(stream)) == expected
pdf = PdfReader(folder / (base + '.pdf'))
compact = lambda value: re.sub(r'\s+', '', str(value))
text = compact(''.join(page.extract_text() for page in pdf.pages))
for row in expected:
    for cell in row:
        assert compact(cell) in text, f'PDF missing {cell}'
print(f'PASS: 40 books, all 40 item titles, 3 chosen columns; Excel/CSV exactly match JSON and PDF contains every cell ({len(pdf.pages)} pages).')
