import { SwingView } from "@/components/swing-view";

import { getSymbols } from "../actions";

export const metadata = {
  title: "Fasi di massimi e minimi — S&P 500",
  description:
    "Segmentazione in fasi alternate: quante barre consecutive formano nuovi massimi prima di un nuovo minimo, e viceversa.",
};

export default async function SwingPage() {
  const symbols = await getSymbols();
  return <SwingView symbols={symbols} />;
}
