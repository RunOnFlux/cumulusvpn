/**
 * Minimal typings for @runonflux/utxo-lib (CommonJS, no upstream types) —
 * only the surface the bridge uses: Flux network params, WIF keypairs, and
 * the Sapling-capable TransactionBuilder.
 */
declare module '@runonflux/utxo-lib' {
  interface Network {
    messagePrefix: string;
    pubKeyHash: number;
    scriptHash: number;
    wif: number;
    consensusBranchId: Record<number, number>;
  }

  interface ECPairInstance {
    getAddress(): string;
    toWIF(): string;
  }

  interface TransactionInstance {
    getId(): string;
    toHex(): string;
    expiryHeight: number;
    versionGroupId: number;
    outs: { script: Buffer; value: number }[];
    ins: { hash: Buffer; index: number }[];
  }

  interface TransactionBuilderInstance {
    setVersion(v: number): void;
    setVersionGroupId(id: number): void;
    setExpiryHeight(h: number): void;
    addInput(txid: string, vout: number): number;
    addOutput(addressOrScript: string | Buffer, value: number): number;
    sign(
      index: number,
      keyPair: ECPairInstance,
      redeemScript: Buffer | null,
      hashType: number,
      value: number,
    ): void;
    build(): TransactionInstance;
  }

  const utxolib: {
    networks: Record<string, Network>;
    ECPair: {
      fromWIF(wif: string, network: Network): ECPairInstance;
      makeRandom(options?: { network?: Network }): ECPairInstance;
    };
    Transaction: {
      SIGHASH_ALL: number;
      fromHex(hex: string, network: Network): TransactionInstance;
    };
    TransactionBuilder: new (network: Network) => TransactionBuilderInstance;
    script: {
      nullData: { output: { encode(data: Buffer): Buffer } };
    };
    address: {
      toOutputScript(address: string, network: Network): Buffer;
      fromOutputScript(script: Buffer, network: Network): string;
    };
  };
  export = utxolib;
}
