/** Raw post-ACK bytes only. No replay, VT screen, reset relay or history reader is imported. */
/** Native admission metadata advances independently of the optional F2 content subscription. */
export class NativeRawAdmission {
  private seq=0;
  private listener:((seq:number,bytes:Buffer)=>void)|null=null;
  get sequence():number{return this.seq;}
  get subscriptions():number{return this.listener?1:0;}
  admit(bytes:Buffer):void{this.seq++;this.listener?.(this.seq,bytes);}
  subscribe(listener:(seq:number,bytes:Buffer)=>void):{dispose:()=>void}{
    if(this.listener)throw new Error('resource_busy');this.listener=listener;
    return {dispose:()=>{if(this.listener===listener)this.listener=null;}};
  }
}
export class ContentQueueBudget {
  private used = 0;
  get bytes(): number { return this.used; }
  reserve(bytes: number): boolean {
    if (bytes < 0 || this.used + bytes > 4194304) return false;
    this.used += bytes; return true;
  }
  release(bytes: number): void { this.used = Math.max(0, this.used - bytes); }
}
export interface ContentReservation { epoch: number; rawSeq: number; byteOffset: number; totalBytes: number; bytes: Buffer; final: boolean }
export class SessionContentExport {
  private epoch = 0;
  private bytes = 0;
  private queue: { rawSeq: number; data: Buffer; offset: number }[] = [];
  private inFlight: ContentReservation | null = null;
  constructor(private readonly budget: ContentQueueBudget) {}
  reset(epoch: number): void { this.clear(); this.epoch = epoch; }
  clear(): void { this.budget.release(this.bytes); this.bytes = 0; this.queue = []; this.inFlight = null; }
  admit(rawSeq: number, data: string|Buffer): boolean {
    const bytes = typeof data==='string'?Buffer.byteLength(data):data.length;
    if (!bytes) return true;
    if (bytes > 1048576 || this.bytes + bytes > 1048576 || this.queue.length >= 4096 || !this.budget.reserve(bytes)) { this.clear(); return false; }
    this.bytes += bytes; this.queue.push({rawSeq,data:Buffer.from(data),offset:0}); return true;
  }
  reserve(): ContentReservation | null {
    if (this.inFlight) return null;
    const head = this.queue[0]; if (!head) return null;
    const end = Math.min(head.offset + 262144, head.data.length);
    this.inFlight = {epoch:this.epoch,rawSeq:head.rawSeq,byteOffset:head.offset,totalBytes:head.data.length,
      bytes:head.data.subarray(head.offset,end),final:end===head.data.length};
    return this.inFlight;
  }
  current(reservation: ContentReservation): boolean { return reservation === this.inFlight && reservation.epoch === this.epoch; }
  commit(reservation: ContentReservation): void {
    if (!this.current(reservation)) return;
    const head = this.queue[0]!; head.offset += reservation.bytes.length;
    // A subarray still retains its complete backing allocation until the raw chunk leaves the queue.
    if (head.offset === head.data.length) {
      this.bytes -= head.data.length; this.budget.release(head.data.length); this.queue.shift();
    }
    this.inFlight = null;
  }
}
