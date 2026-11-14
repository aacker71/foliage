/** Bounded private scratch conversation, never another work record or publication input. */
import type { JourneyRequest, JourneyResponse } from './journeyCollaboration.ts';
export function createJourneySessions() {
  const entries=new Map<string,{revision:string;at:number;message:string;history:JourneyRequest['history'];response:JourneyResponse}>();
  return {
    save(key:string,revision:string,value:{message:string;history:JourneyRequest['history'];response:JourneyResponse}) {
      entries.delete(key);entries.set(key,{revision,at:Date.now(),...value});
      while(entries.size>16) entries.delete(entries.keys().next().value!);
    },
    read(key:string,revision:string) {
      const value=entries.get(key);
      if(!value) return {};
      if(Date.now()-value.at>2*60*60_000){entries.delete(key);return {};}
      if(value.revision===revision)return {message:value.message,history:value.history,response:value.response};
      return {history:[...value.history,{role:'user' as const,text:value.message},{role:'assistant' as const,text:value.response.reply}].slice(-8)};
    },
  };
}
