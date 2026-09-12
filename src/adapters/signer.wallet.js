// El notario. Firma el acta con la llave del agente y verifica la de la
// contraparte recuperando la dirección de la firma. Un agente sin llave no
// puede cerrar tratos: eso es la regla, no un bug.
import { recoverMessageAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { wallets } from './wallets.js';

// ¿Esta dirección firmó este mensaje? Sirve para el acta y para el reto de
// identidad del join: la misma primitiva, dos usos.
export async function signedBy(address, message, signature) {
  if (!address || !signature) return false;
  const signer = await recoverMessageAddress({ message, signature }).catch(() => null);
  return signer?.toLowerCase() === address.toLowerCase();
}

// Tres formas de firmar, en este orden:
//  1. llave de la casa (los agentes de utilería del coliseo)
//  2. autocustodia — el agente probó su dirección y firma él mismo
//  3. custodia del mercado — el que compra desde la web no tiene wallet, así
//     que el mercado le guarda una. Es custodia y el contrato lo dice.
export function walletNotary(remote, custody) {
  const enCustodia = (name) => {
    if (!custody) return null;
    const existente = custody.keyOf(name);
    if (existente) return existente;
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;
    custody.setKey(name, privateKey, address);
    return { privateKey, address };
  };

  const firmarCon = ({ privateKey }, message) => privateKeyToAccount(privateKey).signMessage({ message });

  return {
    custodyOf(name) {
      if (wallets[name]) return 'casa';
      if (remote?.addressOf(name)) return 'propia';
      return 'mercado';
    },

    async sign(name, message) {
      if (wallets[name]) return firmarCon(wallets[name], message);
      // Dirección probada: firma él, nosotros nunca vemos su llave.
      if (remote?.addressOf(name)) return remote.sign(name, message);
      const k = enCustodia(name);
      return k ? firmarCon(k, message) : null;
    },

    async verify(name, message, signature) {
      const address = wallets[name]?.address ?? remote?.addressOf(name) ?? custody?.keyOf(name)?.address;
      return signedBy(address, message, signature);
    },
  };
}
