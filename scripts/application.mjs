// In-place refreshes must not raise a browser over a sheet or PDF the user just opened.
export class CastingWindow extends foundry.applications.api.ApplicationV2 {
  async renderQuiet() {
    this._quietRenders=(this._quietRenders||0)+1;
    try{return await this.render({force:false});}finally{this._quietRenders--;}
  }
  bringToFront(...args) {if(!this._quietRenders)return super.bringToFront(...args);}
  raiseWindow() {return super.bringToFront();}
}
export async function openCharacterSheet(actor) {
  const sheet=actor?.sheet;if(!sheet)throw new Error('This character has no available sheet.');
  await sheet.render(true,{focus:true});
  if(sheet.rendered){await sheet.maximize?.();if(typeof sheet.bringToFront==='function')sheet.bringToFront();else sheet.bringToTop?.();}
}
