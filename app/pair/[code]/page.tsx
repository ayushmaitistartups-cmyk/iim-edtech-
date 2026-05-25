import { PairDeviceClient } from "./PairDeviceClient";

interface PairPageProps {
  params: {
    code: string;
  };
}

export default function PairPage({ params }: PairPageProps): JSX.Element {
  return <PairDeviceClient code={params.code} />;
}
