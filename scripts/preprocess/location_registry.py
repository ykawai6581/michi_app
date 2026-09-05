"""Validation and atomic persistence for independent authored locations."""
from __future__ import annotations
import copy, json, math, os, re, tempfile
from pathlib import Path

ID_PATTERN=re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")

def load_registry(path:Path)->dict:
    if not path.exists(): return {"locations":[]}
    return json.loads(path.read_text(encoding="utf-8"))

def validate_location(value:dict)->dict:
    if not isinstance(value,dict): raise ValueError("Location must be a JSON object")
    location=copy.deepcopy(value); location_id=str(location.get("id","")).strip(); name=str(location.get("displayName","")).strip()
    coordinates=location.get("coordinates"); radius=location.get("revealRadiusPx")
    if not ID_PATTERN.fullmatch(location_id): raise ValueError("id must contain lowercase letters, numbers, and hyphens")
    if not name: raise ValueError("displayName is required")
    if location.get("presentationType","reveal-area")!="reveal-area": raise ValueError("presentationType must be reveal-area")
    if not isinstance(coordinates,list) or len(coordinates)!=2 or any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in coordinates): raise ValueError("coordinates must be finite [longitude, latitude]")
    if not -180<=coordinates[0]<=180: raise ValueError("longitude must be between -180 and 180")
    if not -90<=coordinates[1]<=90: raise ValueError("latitude must be between -90 and 90")
    if isinstance(radius,bool) or not isinstance(radius,(int,float)) or not math.isfinite(radius) or not 40<=radius<=300: raise ValueError("revealRadiusPx must be between 40 and 300")
    return {**location,"id":location_id,"displayName":name,"coordinates":[float(coordinates[0]),float(coordinates[1])],"presentationType":"reveal-area","revealRadiusPx":radius}

def list_locations(path:Path)->list[dict]: return copy.deepcopy(load_registry(path).get("locations",[]))
def get_location(path:Path,location_id:str)->dict:
    try:return copy.deepcopy(next(item for item in list_locations(path) if item.get("id")==location_id))
    except StopIteration as error: raise KeyError(f"Unknown location id {location_id!r}") from error

def _write(path:Path,registry:dict)->None:
    path.parent.mkdir(parents=True,exist_ok=True); temporary=None
    try:
        with tempfile.NamedTemporaryFile("w",encoding="utf-8",dir=path.parent,delete=False) as output:
            json.dump(registry,output,ensure_ascii=False,indent=2);output.write("\n");output.flush();os.fsync(output.fileno());temporary=Path(output.name)
        temporary.replace(path)
    finally:
        if temporary and temporary.exists():temporary.unlink()

def save_location(path:Path,draft:dict,editing_id:str|None=None)->dict:
    location=validate_location(draft);registry=load_registry(path);items=registry.setdefault("locations",[]);matches=[i for i,v in enumerate(items) if v.get("id")==location["id"]]
    if editing_id is None and matches: raise RuntimeError(f"Location {location['id']!r} already exists")
    if editing_id is not None:
        editing=[i for i,v in enumerate(items) if v.get("id")==editing_id]
        if not editing: raise KeyError(f"Unknown location id {editing_id!r}")
        if editing_id!=location["id"] and matches: raise RuntimeError(f"Location {location['id']!r} already exists")
        items[editing[0]]=location
    else:items.append(location)
    _write(path,registry);return location

def delete_location(path:Path,location_id:str)->dict:
    location=get_location(path,location_id);registry=load_registry(path);registry["locations"]=[v for v in registry.get("locations",[]) if v.get("id")!=location_id];_write(path,registry);return location
