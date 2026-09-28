"""Report what an exported spreadsheet actually contains. Usage: python tests/verify-output.py <file.xlsx|file.csv>"""
import sys, csv, io, os

path = sys.argv[1]
if path.endswith(".xlsx"):
    import warnings; warnings.filterwarnings("ignore")
    import openpyxl
    ws = openpyxl.load_workbook(path, read_only=True).active
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
else:
    with io.open(path, encoding="utf-8-sig", newline="") as f:
        rows = [r for r in csv.reader(f)]

hdr = [str(h) if h is not None else "" for h in rows[0]]
data = [list(r) + [None] * (len(hdr) - len(r)) for r in rows[1:]]
val = lambda r, i: ("" if r[i] is None else str(r[i])).strip()

print(f"file      : {os.path.basename(path)}  ({os.path.getsize(path)/1024:.0f} KB)")
print(f"columns   : {hdr}")
print(f"data rows : {len(data):,}")
for i, h in enumerate(hdr):
    filled = sum(1 for r in data if val(r, i))
    distinct = len({val(r, i) for r in data if val(r, i)})
    sample = next((val(r, i) for r in data if val(r, i)), "")
    print(f"  {h[:22]:<22} filled {filled:>6,} ({filled*100//max(1,len(data)):>3}%)  distinct {distinct:>6,}  e.g. {sample[:58]}")

non_ascii = sum(1 for r in data for v in r if isinstance(v, str) and any(ord(c) > 127 for c in v))
print(f"cells with accented/non-English text: {non_ascii:,}")
blank = sum(1 for r in data if not any(val(r, i) for i in range(len(hdr))))
print(f"completely empty rows: {blank}")
print("\nfirst 8 rows:")
for r in data[:8]:
    print("   ", " | ".join(val(r, i)[:26] for i in range(len(hdr))))
