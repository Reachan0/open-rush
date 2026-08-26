// AIGC START
'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { writeActiveProjectId } from '@/lib/active-project';

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data?.id) {
        throw new Error(json.error ?? 'Failed to create project');
      }
      writeActiveProjectId(json.data.id);
      router.push(`/projects/${json.data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">New Project</h1>
        </div>

        <Card className="p-5">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="new-project-name" className="text-sm text-muted-foreground">
                Name
              </label>
              <Input
                id="new-project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Customer workflow"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="new-project-description" className="text-sm text-muted-foreground">
                Description
              </label>
              <Input
                id="new-project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Link href="/dashboard">
                <Button type="button" variant="outline" disabled={saving}>
                  Cancel
                </Button>
              </Link>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? 'Creating...' : 'Create project'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
// AIGC END
