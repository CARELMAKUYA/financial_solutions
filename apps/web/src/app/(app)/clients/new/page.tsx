"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";

export default function NewClientPage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New client" description="Register a client before capturing an application or issuing a loan." />
      <Card>
        <CardContent>
          <ClientForm
            onSaved={(c) => {
              toast.success(`${c.firstName} ${c.lastName} added as ${c.clientNumber}`);
              router.push(`/clients/${c.id}`);
            }}
            onCancel={() => router.back()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
