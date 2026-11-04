import {choiceCommand} from './protocol.mjs';

// A selection stays local until the user explicitly confirms it. Bind it to
// this request object and connection, including revisions with the same rqid.
export class ChoiceDraft {
  value = null;
  stage(context, kind, index, tera = false) {
    if (!context.enabled) throw new Error('Wait for the current battle request.');
    choiceCommand(context.request, kind, index, tera);
    this.value = {...context, kind, index, tera};
    return this.value;
  }
  matches(context) {
    const draft = this.value;
    return !!draft && context.enabled && draft.request === context.request &&
      draft.room === context.room && draft.epoch === context.epoch;
  }
  cancel() { this.value = null; }
  confirm(context, send) {
    if (!this.matches(context)) {
      this.cancel(); throw new Error('The battle changed. Select your move or Pokémon again.');
    }
    const draft = this.value;
    this.cancel();
    choiceCommand(context.request, draft.kind, draft.index, draft.tera);
    send(draft);
  }
}
