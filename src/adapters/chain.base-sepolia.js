// Espejo on-chain de la liquidación: USDC real en Base Sepolia.
// El ledger manda; esto es la prueba pública verificable. Si las wallets no
// tienen gas, falla suave y el mercado sigue (el error viaja en el evento).
import { env } from './secrets.js';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, erc20Abi, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { wallets } from './wallets.js';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // USDC oficial (Circle) en Base Sepolia
const RPC = env('BASE_SEPOLIA_RPC', 'https://sepolia.base.org');

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const VENTANA = 5000n; // bloques por escaneo: los RPC públicos no dan rangos infinitos

// Conversión demo: $1.000 del mercado = 1 USDC de prueba (para no secar el faucet)
const aPesos = (v) => Number(formatUnits(v, 6)) * 1000;
const aUsdc = (pesos) => parseUnits((pesos / 1000).toFixed(6), 6);

const lector = () => createPublicClient({ chain: baseSepolia, transport: http(RPC) });

const clientFor = (name) => createWalletClient({
  account: privateKeyToAccount(wallets[name].privateKey),
  chain: baseSepolia,
  transport: http(RPC),
});

// Acta notarial: ancla la cabeza de la cadena de hashes de la negociación.
// Un tx por negociación, no uno por mensaje: el texto vive en la base de datos
// y cualquiera puede verificar después que no se alteró, sin leerlo.
export async function anchor(chainHead) {
  const hash = `0x${chainHead}`;
  if (!wallets['MARKET-ESCROW']) return { simulated: true, hash };
  try {
    const tx = await clientFor('MARKET-ESCROW').sendTransaction({
      to: wallets['MARKET-ESCROW'].address, value: 0n, data: hash,
    });
    return { hash, tx, explorer: `https://sepolia.basescan.org/tx/${tx}` };
  } catch (e) {
    return { hash, error: e.message }; // el hash existe igual; el anclaje llega cuando haya gas
  }
}

// Depósitos: el USDC que llegó al escrow desde `desde`. Nadie declara su saldo,
// se lee de la cadena. Avanza de a una ventana por escaneo, así se pone al día
// sin pedirle al RPC un rango que no va a dar.
// ponytail: si la base arranca vacía solo mira la última ventana. Para traer
// depósitos viejos, arranca con DEPOSITS_FROM_BLOCK.
export async function incomingTransfers(desde = 0) {
  if (!wallets['MARKET-ESCROW']) return { deposits: [], toBlock: null };
  const client = lector();
  const cabeza = await client.getBlockNumber();
  const arranque = BigInt(desde || process.env.DEPOSITS_FROM_BLOCK || 0);
  const from = arranque ? arranque + 1n : (cabeza > VENTANA ? cabeza - VENTANA : 0n);
  if (from > cabeza) return { deposits: [], toBlock: Number(cabeza) };
  const to = from + VENTANA < cabeza ? from + VENTANA : cabeza;

  const logs = await client.getLogs({
    address: USDC, event: TRANSFER,
    args: { to: wallets['MARKET-ESCROW'].address },
    fromBlock: from, toBlock: to,
  });
  return {
    deposits: logs.map((l) => ({
      txHash: l.transactionHash, logIndex: l.logIndex,
      from: l.args.from, amount: aPesos(l.args.value),
    })),
    toBlock: Number(to),
  };
}

// Retiro: la única vez que la plata sale del escrow. Los tratos se netean en
// el ledger, no se pagan uno por uno en la cadena.
export async function withdraw(to, pesos) {
  if (!wallets['MARKET-ESCROW']) return { simulated: true, note: 'sin wallets.json' };
  const hash = await clientFor('MARKET-ESCROW').writeContract({
    address: USDC, abi: erc20Abi, functionName: 'transfer', args: [to, aUsdc(pesos)],
  });
  return { hash, explorer: `https://sepolia.basescan.org/tx/${hash}` };
}
