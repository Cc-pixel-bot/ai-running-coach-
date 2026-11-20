from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pathlib import Path
import json, random

OUT = Path(r'D:\codex-ai跑步教练\docs\evaluation\首次计划评测100组样本.docx')
random.seed(20261112)

# Construct 100 synthetic, API-valid runner profiles. Most are ordinary coverage cases;
# the final eight are valid boundary or stress cases, not malformed API requests.
levels = [('L0', 20), ('L1', 30), ('L2', 30), ('L3', 20)]
profiles=[]
idx=1
health_options=['近期无明显伤痛','膝盖 / 髋骨曾有酸痛','跟腱 / 足底筋膜敏感','腰背部偶尔不适']
for level,count in levels:
    for j in range(count):
        # Capacity ranges are plausible but intentionally varied; course level is explicit
        # in bodyData because the current backend uses this tag for retrieval routing.
        if level=='L0':
            longest=round(3.0 + (j%8)*0.2,1); latest=None
        elif level=='L1':
            longest=round(5.5 + (j%10)*0.35,1)
            latest=None if j%3==0 else float(68 + (j%13))
        elif level=='L2':
            longest=round(7.0 + (j%12)*0.55,1)
            latest=float(50 + (j%19))
        else:
            longest=round(10.0 + (j%11)*0.9,1)
            latest=float(40 + (j%16))
        days=[3,4,5,6,7][(idx+j)%5]
        if level=='L0': days=[3,4,5][(idx+j)%3]
        # Moderate goal range; some target times are intentionally faster than current
        # performance to test that target is not used as current ability.
        target=70 - ((idx*3)%25)
        if latest is not None and idx%4==0:
            target=min(70, max(40, int(latest)-8))
        health='近期无明显伤痛'
        if idx%11==0: health=health_options[1]
        elif idx%17==0: health=health_options[2]
        elif idx%23==0: health=health_options[3]
        height=150 + ((idx*7)%61)
        weight=round((height/100)**2 * (20 + idx%8))
        phase='base'
        if idx%10==0: phase='build'
        if idx%25==0: phase='taper'
        profiles.append(dict(id=idx, level=level, tag='常规覆盖', profile={
            'height':height,'weight':weight,'goal':'完成 10 公里','longestRunKm':longest,
            'latest10kMinutes':latest,'trainDays':days,'targetMinutes':target,
            'health':[health],'healthStatus':health,'bodyData':{'level':level,'phase':phase}
        }))
        idx+=1
# Eight deliberately selected edge cases are distributed across all four levels.
edge_specs=[
 ('L0',3.0,None,3,70,'近期无明显伤痛','base','当前连续跑能力较低，且无近期成绩'),
 ('L0',3.8,None,3,40,'近期无明显伤痛','base','最低档能力、最低频次与激进目标组合'),
 ('L1',5.0,80,3,40,'近期无明显伤痛','base','当前成绩偏慢但目标明显激进，检验不以目标代替能力'),
 ('L1',7.0,None,7,65,'近期无明显伤痛','build','无近期成绩且训练频次为7天，检验负荷安排保守性'),
 ('L2',10.0,50,3,42,'膝盖 / 髋骨曾有酸痛','base','已知伤痛史与低频训练组合'),
 ('L2',8.0,68,4,40,'跟腱 / 足底筋膜敏感','build','成绩较慢但目标激进，并有明确身体限制'),
 ('L3',20.0,40,7,40,'近期无明显伤痛','peak','较高跑量基础与最高训练频次边界'),
 ('L3',10.0,55,3,40,'腰背部偶尔不适','taper','目标明显快于近期成绩，且包含身体限制'),
]
edge_indices=[0,1,20,21,50,51,80,81]
for k,(lv,longest,latest,days,target,health,phase,why) in enumerate(edge_specs):
    p=profiles[edge_indices[k]]
    p.update(level=lv,tag='边界/特殊',edge_reason=why)
    p['profile'].update({'longestRunKm':longest,'latest10kMinutes':latest,'trainDays':days,'targetMinutes':target,
                         'health':[health],'healthStatus':health,'bodyData':{'level':lv,'phase':phase}})

# Verify count, accepted enums, numeric ranges and account identifiers before writing.
assert len(profiles)==100
for x in profiles:
    p=x['profile']; assert p['height'] in range(150,211) and p['weight'] in range(40,121)
    assert 0 <= p['longestRunKm'] <= 500 and 3 <= p['trainDays'] <= 7
    assert p['latest10kMinutes'] is None or 40 <= p['latest10kMinutes'] <= 80
    assert 40 <= p['targetMinutes'] <= 70 and p['bodyData']['level'] in {'L0','L1','L2','L3'}


def shade(cell, fill):
    tcPr=cell._tc.get_or_add_tcPr(); shd=OxmlElement('w:shd'); shd.set(qn('w:fill'),fill); tcPr.append(shd)
def set_cell_margins(cell, top=65, start=90, bottom=65, end=90):
    tc=cell._tc; tcPr=tc.get_or_add_tcPr(); mar=tcPr.first_child_found_in('w:tcMar')
    if mar is None: mar=OxmlElement('w:tcMar'); tcPr.append(mar)
    for m,v in [('top',top),('start',start),('bottom',bottom),('end',end)]:
        el=mar.find(qn('w:'+m))
        if el is None: el=OxmlElement('w:'+m); mar.append(el)
        el.set(qn('w:w'),str(v)); el.set(qn('w:type'),'dxa')
def border_table(table, color='D8E0E8', size='5'):
    tblPr=table._tbl.tblPr; borders=OxmlElement('w:tblBorders')
    for edge in ('top','left','bottom','right','insideH','insideV'):
        e=OxmlElement('w:'+edge); e.set(qn('w:val'),'single'); e.set(qn('w:sz'),size); e.set(qn('w:space'),'0'); e.set(qn('w:color'),color); borders.append(e)
    tblPr.append(borders)
def set_repeat_table_header(row):
    trPr=row._tr.get_or_add_trPr(); e=OxmlElement('w:tblHeader'); e.set(qn('w:val'),'true'); trPr.append(e)
def set_font(run, name='Microsoft YaHei', size=8.5, bold=False, color='243247'):
    run.font.name=name; run._element.rPr.rFonts.set(qn('w:eastAsia'),name); run.font.size=Pt(size); run.bold=bold; run.font.color.rgb=RGBColor.from_string(color)

doc=Document(); sec=doc.sections[0]
sec.top_margin=Inches(.62); sec.bottom_margin=Inches(.62); sec.left_margin=Inches(.62); sec.right_margin=Inches(.62)
sec.header_distance=Inches(.28); sec.footer_distance=Inches(.28)
styles=doc.styles
styles['Normal'].font.name='Microsoft YaHei'; styles['Normal']._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei'); styles['Normal'].font.size=Pt(9); styles['Normal'].font.color.rgb=RGBColor(36,50,71)
styles['Normal'].paragraph_format.space_after=Pt(3)
styles['Title'].font.name='Microsoft YaHei'; styles['Title']._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei'); styles['Title'].font.size=Pt(22); styles['Title'].font.bold=True; styles['Title'].font.color.rgb=RGBColor(0,0,0)
title_ppr=styles['Title']._element.get_or_add_pPr()
title_border=title_ppr.find(qn('w:pBdr'))
if title_border is not None: title_ppr.remove(title_border)
for stname,size in [('Heading 1',14),('Heading 2',11)]:
    st=styles[stname]; st.font.name='Microsoft YaHei'; st._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei'); st.font.size=Pt(size); st.font.bold=True; st.font.color.rgb=RGBColor(0,0,0); st.paragraph_format.space_before=Pt(9); st.paragraph_format.space_after=Pt(4)
header=sec.header.paragraphs[0]; header.alignment=WD_ALIGN_PARAGRAPH.RIGHT
rr=header.add_run('智程 AI 跑步教练｜首次计划样本'); set_font(rr,size=8,color='64748B')
footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
r=footer.add_run('内部评测素材 · 全部档案均为虚构数据'); set_font(r,size=8,color='64748B')

p=doc.add_paragraph(style='Title'); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.add_run('首次计划评测 100 组样本')
p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
set_font(p.add_run('用于覆盖不同跑者水平的首次 10km 训练计划生成'),size=11,color='52647A')
intro=doc.add_paragraph('本文件只包含 100 组虚构跑者档案输入，不包含 AI 计划、评分或运行结果。样本按项目当前档案 API 字段整理，可用于创建独立测试账号并逐一生成首次计划。所有数据仅用于测试，不代表真实跑者或医疗建议。')
intro.paragraph_format.space_after=Pt(8)
doc.add_heading('样本覆盖',level=1)
t=doc.add_table(rows=1, cols=3); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
widths=[Inches(1.15),Inches(1.05),Inches(4.45)]
for i,w in enumerate(widths): t.columns[i].width=w
headers=['覆盖组','数量','说明']
for c,txt in zip(t.rows[0].cells,headers):
    c.width=widths[headers.index(txt)]; shade(c,'18324A'); set_cell_margins(c,100,110,100,110)
    rr=c.paragraphs[0].add_run(txt); set_font(rr,size=9,bold=True,color='FFFFFF')
set_repeat_table_header(t.rows[0])
for row in [('L0 初跑/跑走','20','侧重低基础、无近期成绩和保守起步'),('L1 基础建立','30','覆盖连续跑能力初建、部分无近期成绩'),('L2 稳定跑者','30','覆盖已有 10km 能力与适量质量训练基础'),('L3 稳定训练','20','覆盖较强基础、阶段与频次变化'),('边界/特殊组合','8（包含在以上数量中）','集中覆盖目标明显激进、健康限制、输入边界和高训练频次')]:
    cells=t.add_row().cells
    for i,(c,txt) in enumerate(zip(cells,row)):
        c.width=widths[i]; c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER; set_cell_margins(c,80,110,80,110)
        if len(t.rows)%2==0: shade(c,'F3F7FA')
        rr=c.paragraphs[0].add_run(txt); set_font(rr,size=8.5,bold=(i==0))

doc.add_heading('字段与使用说明',level=1)
for text in [
    '每条档案以 JSON 对象列出，profile 字段可用于后端 RunnerProfile；表格中的 evalplan 编号是登录账号名，不属于档案 JSON，测试时需另行设置密码。',
    'bodyData.level 与 bodyData.phase 用于当前后端生成 Dify 检索标签；其中 level 覆盖 L0–L3，phase 覆盖 base、build、peak、taper。',
    '当前前端建档没有 level/phase 输入项，若要保证四档覆盖，应通过测试 API 写入 bodyData，或使用支持该字段的测试工具；只走前端建档会由后端默认按 L1 路由。前端把最长连续跑限制为 5–20 km，而 L0 样本低于 5 km，因此 L0 需通过 API 创建。',
    'targetMinutes 表示目标成绩，latest10kMinutes 表示近期实际成绩。两者有意设置部分差异，以便评测是否按当前能力安排，而不是把目标成绩当作现状。null 表示未提供近期 10km 成绩。',
    '所有样本均在当前接口允许范围内；特殊样本是有效的边界/压力组合，不是非法输入。账号不含姓名、联系方式等个人信息。'
]:
    para=doc.add_paragraph(style='Normal'); para.paragraph_format.left_indent=Inches(.12); para.paragraph_format.first_line_indent=Inches(-.12)
    set_font(para.add_run('• '+text),size=8.5)

doc.add_page_break()
doc.add_heading('100 组跑者档案输入',level=1)
doc.add_paragraph('每个 evalplan 编号对应一个独立测试账号；少量特殊组合的原因列在第二栏，不属于档案字段。')

rows=[]
for x in profiles:
    p=x['profile']; acct=f'evalplan{x["id"]:03d}'
    payload=p
    rows.append((x['id'],acct,x['level'],x['tag'],json.dumps(payload,ensure_ascii=False,separators=(',',':'))))
t=doc.add_table(rows=1,cols=3); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
widths=[Inches(.55),Inches(1.45),Inches(4.65)]
for i,w in enumerate(widths): t.columns[i].width=w
for i,txt in enumerate(['编号','水平 / 类型','档案输入 JSON']):
    c=t.rows[0].cells[i]; c.width=widths[i]; shade(c,'18324A'); set_cell_margins(c,90,90,90,90)
    rr=c.paragraphs[0].add_run(txt); set_font(rr,size=8.5,bold=True,color='FFFFFF')
set_repeat_table_header(t.rows[0])
for n,acct,lv,tag,payload in rows:
    cells=t.add_row().cells
    case=next(x for x in profiles if x['id']==n)
    label=f'{acct}\n{lv} · {tag}' + (f"\n{case['edge_reason']}" if case.get('edge_reason') else '')
    vals=[f'{n:03d}',label,payload]
    for i,(c,txt) in enumerate(zip(cells,vals)):
        c.width=widths[i]; c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER; set_cell_margins(c,58,82,58,82)
        if n%2==0: shade(c,'F3F7FA')
        para=c.paragraphs[0]; para.paragraph_format.space_after=Pt(0); para.paragraph_format.line_spacing=1.02
        rr=para.add_run(txt); set_font(rr,name='Consolas' if i==2 else 'Microsoft YaHei',size=7.3 if i==2 else 8,bold=(i==0),color='243247')
        if i==2: rr._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei')
border_table(t)
# Make all repeated row content survive page breaks and keep row units intact.
for row in t.rows:
    trPr=row._tr.get_or_add_trPr(); cant=OxmlElement('w:cantSplit'); cant.set(qn('w:val'),'1'); trPr.append(cant)

# Set all tables' borders and prevent a final table row from being orphaned.
for table in doc.tables:
    border_table(table)

OUT.parent.mkdir(parents=True,exist_ok=True)
doc.save(OUT)
print(f'created {OUT} ({len(profiles)} profiles)')

