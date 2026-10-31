import type {Catalog,PoseRow} from './core.js';
export function mountGallery(root:HTMLElement,options?:{catalog?:Catalog;onImport?:(row:PoseRow,signal:AbortSignal)=>Promise<void>;importLabel?:string;importSuccessText?:string;licenseText?:string}):()=>void;
