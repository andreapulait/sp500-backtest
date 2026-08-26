import { GapView } from "@/components/gap-view";

import { getSymbols } from "../actions";

export const metadata = {
  title: "Gap di apertura — S&P 500",
  description:
    "Distribuzione per classi di ampiezza del gap di apertura, con due periodi storici a confronto.",
};

export default async function GapPage() {
  const symbols = await getSymbols();
  return <GapView symbols={symbols} />;
}
