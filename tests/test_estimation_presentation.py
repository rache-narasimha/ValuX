"""Identity, floor grouping, signatures and area presentation for estimation workbooks."""
import copy
from io import BytesIO
from pathlib import Path
from openpyxl import load_workbook
from backend.app.estimation import generate_estimation_workbook
from backend.app.estimation.presentation import component_labels, compact_abstract

OUT = Path('outputs/test_artifacts'); OUT.mkdir(parents=True, exist_ok=True)
DETAILS = {'identityVersion':2, 'applicantName':'Sample Applicant, Adoni', 'workDescription':'Residential building in GF and FF', 'workAddress':'Plot No. 52, Mandigiri, Adoni', 'estimateDate':'2026-11-05', 'place':'Adoni'}

def floor(key, label, level, amount, area):
    return {'id':key,'key':key,'label':label,'level':level,'formData':{'finalAmount':amount,'plinthArea':area}}

def strings(sheet):
    return [str(cell.value) for row in sheet for cell in row if cell.value is not None]

state={'propertyType':'residential','details':copy.deepcopy(DETAILS),'components':[{'id':'home','kind':'residential_building','name':'Residential Building / Block 1','sheets':[floor('ground','Ground Floor',1,120000,755.52),floor('first','First Floor',2,180000,600.48)]}]}
result=generate_estimation_workbook(state); result.save(OUT/'estimation_compact_presentation.xlsx')
w=load_workbook(BytesIO(result.content)); assert w.sheetnames==['Ground Floor','First Floor']
gf,ff=w.worksheets
assert gf['A11'].value=='Name of the Applicant : Sample Applicant, Adoni'
assert gf['A8'].value.count('Plot No. 52')==1 and 'Residential building in GF and FF' in gf['A8'].value
assert '755.52' in gf['A14'].value
assert ff.row_dimensions[1].hidden and ff['A8'].value is None and ff['A11'].value is None
assert ff['A14'].value.startswith('FIRST FLOOR') and '600.48' in ff['A14'].value
assert not any('Overall Plinth Area' in value for value in strings(ff))
assert not any('Place :' in value or 'SIGNATURE OF VALUER' in value for value in strings(gf))
place=[i for i in range(1,ff.max_row+1) if str(ff.cell(i,1).value).startswith('Place :')][0]
assert str(ff.cell(place+1,1).value).startswith('Date :')
assert sum(value=='SIGNATURE OF VALUER' for sheet in w for value in strings(sheet))==1
for sheet in w:
    assert sheet.sheet_view.pane is None
    assert not any('#REF!' in value for value in strings(sheet))
    assert any('SUM(' in value for value in strings(sheet))
w.close()

multi=copy.deepcopy(state);multi['propertyType']='industrial'
multi['components'][0]['kind']='office_amenity';multi['components'][0]['name']='Office Building'
multi['components'].append({'id':'quarters','kind':'rcc_building','name':'Staff Quarters','sheets':[floor('ground','Ground Floor',1,50000,200)]})
multi['components'].insert(0,{'id':'hall','kind':'heavy_machinery_hall','name':'Heavy Machinery Hall','formData':{'finalAmount':200000,'plinthArea':1000}})
result=generate_estimation_workbook(multi);result.save(OUT/'estimation_multi_presentation.xlsx')
w=load_workbook(BytesIO(result.content));assert w.sheetnames==['Abstract','Heavy Machinery Hall','Office Building GF','Office Building FF','Staff Quarters GF']
assert w['Abstract']['A14'].value is None
assert not any('Plinth Area' in value for value in strings(w['Abstract']))
assert 'Residential building in GF and FF' in w['Heavy Machinery Hall']['A8'].value
assert w['Office Building GF']['A8'].value == w['Heavy Machinery Hall']['A8'].value
assert w['Office Building FF']['A8'].value is None
assert sum(value=='SIGNATURE OF VALUER' for sheet in w for value in strings(sheet))==1
assert all(not any('Place :' in value for value in strings(sheet)) for sheet in list(w)[1:])
assert all(len(name)<=31 for name in w.sheetnames)
w.close()

three=copy.deepcopy(state);three['components'][0]['sheets'].append(floor('second','Second Floor',3,1000,100));assert compact_abstract(three)
three['components'][0]['sheets'][0]['typicalFloorKeys']=['ground','third'];assert not compact_abstract(three)
assert not compact_abstract(multi)
override=copy.deepcopy(state);override['details']['plinthArea']=1500
w=load_workbook(BytesIO(generate_estimation_workbook(override).content));assert not any('Overall Plinth Area' in value for sheet in w for value in strings(sheet));assert '755.52' in w['Ground Floor']['A14'].value;w.close()
text_area = copy.deepcopy(state)
text_area['components'][0]['sheets'][0]['formData']['plinthArea'] = '755.52 sft. (GF only)'
w = load_workbook(BytesIO(generate_estimation_workbook(text_area).content))
assert w['Ground Floor']['A14'].value == 'Plinth Area : 755.52 sft. (GF only)'
w.close()
for source in (state, multi):
    for mode in ('completed', 'offline'):
        w=load_workbook(BytesIO(generate_estimation_workbook(source, mode=mode).content))
        assert not any('Overall Plinth Area' in value for sheet in w for value in strings(sheet))
        assert any('Plinth Area' in value for sheet in w if sheet.title != 'Abstract' for value in strings(sheet))
        if 'Abstract' in w: assert not any('Plinth Area' in value for value in strings(w['Abstract']))
        w.close()
print('PASS: shared work identity, floor naming, compact rule, plinth areas, single signature and free scrolling')
