import type {Road} from './model'

export function MapClassificationField({value,onChange}:{value:Road['presentationType'];onChange:(value:Road['presentationType'])=>void}){
  return <fieldset><legend>Map classification</legend><label className="inline"><input type="radio" checked={value==='road'} onChange={()=>onChange('road')}/>Modern road</label><label className="inline"><input type="radio" checked={value==='historical-road'} onChange={()=>onChange('historical-road')}/>歴史街道</label></fieldset>
}
