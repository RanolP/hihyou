// The core compiles with neither DOM nor node types, so it may only use globals that both hosts share; they are declared here.
declare global {
  class TextDecoder {
    decode(input?: Uint8Array): string;
  }
  class TextEncoder {
    encode(input?: string): Uint8Array;
  }
}

export {};
