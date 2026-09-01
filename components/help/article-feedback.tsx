"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ArticleFeedback({
  question,
  yes,
  no,
  thanks,
}: {
  question: string;
  yes: string;
  no: string;
  thanks: string;
}) {
  const [answered, setAnswered] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-muted/30 px-5 py-6 text-center">
      {answered ? (
        <p className="font-medium text-primary" role="status">{thanks}</p>
      ) : (
        <>
          <p className="font-medium">{question}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={() => setAnswered(true)}>
              <ThumbsUp />
              {yes}
            </Button>
            <Button variant="outline" onClick={() => setAnswered(true)}>
              <ThumbsDown />
              {no}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
