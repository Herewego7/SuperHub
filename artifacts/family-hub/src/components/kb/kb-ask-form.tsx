import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface KbAskFormProps {
  searchQuery: string;
}

export function KbAskForm({ searchQuery }: KbAskFormProps) {
  const [question, setQuestion] = useState("");
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  const askMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/kb/questions", {
        question: question.trim(),
        searchQuery: searchQuery.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setSent(true);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't send your question",
        description: err.message || "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  if (sent) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
        <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-foreground">Question sent!</p>
        <p className="text-xs text-muted-foreground mt-1">
          We'll reply to your account's email, and use it to add a new help article.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <Mail className="w-4 h-4" />
          Still stuck? Ask us directly
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          We'll reply by email — and use your question to add a new article for the next person.
        </p>
      </div>
      <Textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value.slice(0, 2000))}
        placeholder="What are you trying to do?"
        rows={3}
        className="text-sm resize-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{question.length}/2000</span>
        <Button
          size="sm"
          disabled={question.trim().length < 5 || askMutation.isPending}
          onClick={() => askMutation.mutate()}
        >
          {askMutation.isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Sending…
            </>
          ) : (
            "Send question"
          )}
        </Button>
      </div>
    </div>
  );
}
