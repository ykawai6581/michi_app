import{renderToStaticMarkup}from'react-dom/server'
import{describe,expect,it}from'vitest'
import{ExistingProjectNotice,HistoricalRouteRow,ProjectSaveActions}from'./ProjectEditor'
import{emptyProject,projectSavePlan}from'./projectModel'
describe('historical route catalog row',()=>{it('renders the API route ID, name, endpoints and alias without dash placeholders',()=>{const html=renderToStaticMarkup(<HistoricalRouteRow route={{routeId:'R003',name:'甲州道中',altName:'甲州街道',start:'江戸',end:'下諏訪'}} project={emptyProject()} onChange={()=>{}}/>);expect(html).toContain('甲州道中');expect(html).toContain('R003');expect(html).toContain('江戸 → 下諏訪');expect(html).toContain('別名: 甲州街道');expect(html).not.toContain('—</')})})
describe('project save actions',()=>{
 it('shows create labels for a genuinely new ID',()=>{const html=renderToStaticMarkup(<ProjectSaveActions plan={projectSavePlan('new-project',['shinjuku'])} onSave={()=>{}}/>);expect(html).toContain('Save Project');expect(html).toContain('Save &amp; Build');expect(html).not.toContain('Update Project')})
 it('shows update labels and an overwrite notice for an existing exact ID',()=>{const plan=projectSavePlan('shinjuku',['shinjuku']);const html=renderToStaticMarkup(<><ExistingProjectNotice project={{id:'shinjuku',displayName:'新宿'}}/><ProjectSaveActions plan={plan} onSave={()=>{}}/></>);expect(html).toContain('Existing project: shinjuku');expect(html).toContain('replace the existing project configuration');expect(html).toContain('Update Project');expect(html).toContain('Update &amp; Build')})
})
