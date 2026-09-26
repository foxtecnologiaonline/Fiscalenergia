import { ConsumerUnitForm } from "@/components/units/consumer-unit-form";

export default function NewConsumerUnitPage() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-semibold">Nova unidade consumidora</h1>
      <ConsumerUnitForm mode="create" />
    </div>
  );
}
