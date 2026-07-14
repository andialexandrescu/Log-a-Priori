'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectSetupTabs } from "@/features/projects/components/project-setup-tabs";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (project: any) => void;
}

export const CreateProjectDialog = ({ open, onOpenChange, onSuccess }: CreateProjectDialogProps) => {
  const handleSuccess = (project: any) => {
    onSuccess?.(project);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Name your project and choose the repository folder on this machine, the knowledge graph is
            generated automatically when you finish
          </DialogDescription>
        </DialogHeader>
        <ProjectSetupTabs onSuccess={handleSuccess} />
      </DialogContent>
    </Dialog>
  );
};

export default CreateProjectDialog;
