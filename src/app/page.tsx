import { Workbench } from "@/components/workbench";
import { DEFAULT_REQUEST } from "@/lib/analysis";

import { getSymbolMeta, getSymbols } from "./actions";

export default async function Page() {
  const [symbols, meta] = await Promise.all([
    getSymbols(),
    getSymbolMeta(DEFAULT_REQUEST.symbol),
  ]);

  return <Workbench symbols={symbols} initialMeta={meta} />;
}
