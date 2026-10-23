import { createClient } from "@supabase/supabase-js";
import { demoClient } from "./demo";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Demo mode: sample data in memory, no Supabase needed.
export const isDemo = import.meta.env.VITE_DEMO === "1" || !(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
export const configured = true;
const real = createClient(url || "http://localhost:54321", key || "missing-anon-key");
export const supabase: typeof real = isDemo ? demoClient : real;
export const functionsUrl = `${isDemo ? "https://demo.supabase.co" : url}/functions/v1`;
