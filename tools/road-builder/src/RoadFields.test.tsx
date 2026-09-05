import{renderToStaticMarkup}from'react-dom/server'
import{describe,expect,it,vi}from'vitest'
import{MapClassificationField}from'./RoadFields'

describe('map classification field',()=>{
  it('shows both choices and selects modern roads by default',()=>{
    const html=renderToStaticMarkup(<MapClassificationField value="road" onChange={()=>{}}/>)
    expect(html).toContain('Modern road');expect(html).toContain('歴史街道');expect(html).toMatch(/checked=""[^>]*\/>Modern road/)
  })
  it('restores and edits the historical-road classification',()=>{
    const html=renderToStaticMarkup(<MapClassificationField value="historical-road" onChange={()=>{}}/>)
    expect(html).toMatch(/checked=""[^>]*\/>歴史街道/)
    const onChange=vi.fn(),field=MapClassificationField({value:'road',onChange})
    field.props.children[2].props.children[0].props.onChange()
    expect(onChange).toHaveBeenCalledWith('historical-road')
  })
})
