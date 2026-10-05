/** Refresh proof PDFs with the production exporter after a layout fix. */
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {buildFile} from "../lib/exporters";
const dir=process.argv[2] || "output/verified-final-2026-10-05";
for(const name of ["quotes-customized","buchmesse-with-contacts-sample"]) {
  const rows=JSON.parse(await readFile(path.join(dir,`${name}.json`),"utf8"));
  const out=await buildFile("pdf",rows,Object.keys(rows[0]),name,async(file)=>{
    const bytes=await readFile(path.join("public/fonts",file));
    return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
  });
  await writeFile(path.join(dir,out.filename),Buffer.from(await out.blob.arrayBuffer()));
  console.log("Refreshed",out.filename);
}
