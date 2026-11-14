/** The Collection schedule gate in plain words. Journey updates and Jev's checks both wait for it. */
import type { WorkflowSnapshot } from './workflow.ts';

/**
 * Whether Collection would let a scheduled step run, and the words for why not. Quiet hours are
 * named as a window rather than judged against the clock: they end on their own, and a renderer
 * that read the time would say something different on every reload.
 */
export function collectionGate(workflow: Pick<WorkflowSnapshot,'schedule'>|undefined): {readonly open:boolean;readonly label:string;readonly reason?:'workflow_closed'|'schedule_missing'|'schedule_paused'} {
  // `reason` is the gated journey update's word for the same state, so its next step is worded once.
  if(!workflow) return {open:false,label:'Collection is unavailable',reason:'workflow_closed'};
  const s=workflow.schedule;
  if(!s) return {open:false,label:"Collection isn't scheduled",reason:'schedule_missing'};
  if(s.paused) return {open:false,label:'Collection is paused',reason:'schedule_paused'};
  return {open:true,label:s.quiet?`Collection is scheduled · quiet hours ${s.start}–${s.end}`:'Collection is scheduled'};
}
