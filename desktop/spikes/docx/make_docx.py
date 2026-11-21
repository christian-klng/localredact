# Spike: writes a DOCX containing the cases that matter for redaction - tracked
# changes, hidden text, a comment, header, footer, footnote, white text, a table,
# a text box and document properties - each tagged with a unique marker.
#
#   python3 make_docx.py <out.docx>
import zipfile, sys
W='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml"'
def p(text, rpr=''): return f'<w:p><w:r>{("<w:rPr>"+rpr+"</w:rPr>") if rpr else ""}<w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
filler=''.join(p(f'Fuelltext Zeile {i}: Die Akteneinsicht wird nach Paragraf 29 VwVfG gewaehrt, soweit schutzwuerdige Interessen Dritter nicht entgegenstehen.') for i in range(1,26))
TITLE=p('Bescheid ueber den Antrag auf Akteneinsicht', '<w:b/><w:sz w:val="32"/>')
WHITE=p('WEISS-4444 weisser Text auf weissem Grund', '<w:color w:val="FFFFFF"/>')
body=f'''
{TITLE}
{p("Sichtbarer Absatz ALPHA-1001 von Frau Lena Hoffmann.")}
<w:p><w:r><w:t xml:space="preserve">Nachverfolgung: </w:t></w:r><w:ins w:id="1" w:author="Petra Lindner" w:date="2026-03-01T10:00:00Z"><w:r><w:t>EINGEFUEGT-2002 </w:t></w:r></w:ins><w:del w:id="2" w:author="Petra Lindner" w:date="2026-03-01T10:00:00Z"><w:r><w:delText>GELOESCHT-3003 Thomas Berger </w:delText></w:r></w:del><w:r><w:t>Ende.</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Vor dem Versteckten. </w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>VERSTECKT-4004 interne Notiz</w:t></w:r><w:r><w:t xml:space="preserve"> Nach dem Versteckten.</w:t></w:r></w:p>
<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Kommentierte Stelle.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Satz mit Fussnote</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="2"/></w:r><w:r><w:t>.</w:t></w:r></w:p>
{WHITE}
<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>
<w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Telefon</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>TABELLE-9009 Maria Berger-Yilmaz</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>0171 5550142</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:pict><v:shape style="width:200pt;height:40pt"><v:textbox><w:txbxContent>{p("TEXTFELD-1111 im Textfeld")}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>
{filler}
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
{p("SEITE2-3333 Text nach manuellem Seitenumbruch.")}
'''
doc=f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>'
files={
'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
'_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
'word/_rels/document.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
'word/document.xml':doc,
'word/comments.xml':f'<?xml version="1.0" encoding="UTF-8"?><w:comments {W}><w:comment w:id="0" w:author="Petra Lindner" w:date="2026-03-01T10:00:00Z" w:initials="PL">{p("KOMMENTAR-5005 bitte vor Herausgabe pruefen")}</w:comment></w:comments>',
'word/footnotes.xml':f'<?xml version="1.0" encoding="UTF-8"?><w:footnotes {W}><w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="2">{p("FUSSNOTE-8008 Quelle: Schreiben vom 3. Februar 2026")}</w:footnote></w:footnotes>',
'word/header1.xml':f'<?xml version="1.0" encoding="UTF-8"?><w:hdr {W}>{p("KOPFZEILE-6006 Stadt Neuenkirchen, Az. BO-2026-0417")}</w:hdr>',
'word/footer1.xml':f'<?xml version="1.0" encoding="UTF-8"?><w:ftr {W}>{p("FUSSZEILE-7007 Sachbearbeitung Dr. Petra Lindner")}</w:ftr>',
'docProps/core.xml':'<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>TITEL-META</dc:title><dc:creator>AUTOR-2222</dc:creator><cp:lastModifiedBy>BEARBEITER-META</cp:lastModifiedBy></cp:coreProperties>',
}
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:
    for n,c in files.items(): z.writestr(n,c)
