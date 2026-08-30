import{renderToStaticMarkup}from'react-dom/server'
import{describe,expect,it}from'vitest'
import{HistoricalRouteRow}from'./ProjectEditor'
import{emptyProject}from'./projectModel'
describe('historical route catalog row',()=>{it('renders the API route ID, name, endpoints and alias without dash placeholders',()=>{const html=renderToStaticMarkup(<HistoricalRouteRow route={{routeId:'R003',name:'甲州道中',altName:'甲州街道',start:'江戸',end:'下諏訪'}} project={emptyProject()} onChange={()=>{}}/>);expect(html).toContain('甲州道中');expect(html).toContain('R003');expect(html).toContain('江戸 → 下諏訪');expect(html).toContain('別名: 甲州街道');expect(html).not.toContain('—</')})})
