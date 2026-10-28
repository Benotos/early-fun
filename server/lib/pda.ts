import { PublicKey } from '@solana/web3.js';
import { PUMP_PROGRAM } from './env';

const program = new PublicKey(PUMP_PROGRAM);

export function curveAddress(mint: string): string {
  return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], program)[0].toBase58();
}
