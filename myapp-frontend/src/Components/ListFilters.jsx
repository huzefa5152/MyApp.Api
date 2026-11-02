import {useEffect, useState} from 'react';
import './RecordsViewport.css';

export default function ListFilters({children,label="Filters"}) {
  const [open,setOpen]=useState(()=>typeof window==='undefined'||window.innerWidth>767);
  useEffect(()=>{
    if(typeof window.matchMedia!=='function')return;
    const media=window.matchMedia('(max-width:767px)');
    const change=()=>setOpen(!media.matches);
    media.addEventListener('change',change);
    return()=>media.removeEventListener('change',change);
  },[]);
  return <details className="list-filters" open={open}>
    <summary onClick={event=>{event.preventDefault();setOpen(value=>!value);}}>{label}<span>{open?'Hide':'Show'}</span></summary>
    <div className="list-filters-content">{children}</div>
  </details>;
}
