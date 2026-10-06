/// <reference types="vite/client" />

declare const __BUILD_ID__: string;

// Chaves PUBLICAS do Supabase (a Publishable key; nunca a secreta). Opcionais: sem elas o app funciona sem conta.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
