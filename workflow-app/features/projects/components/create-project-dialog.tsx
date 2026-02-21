'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectSetupTabs } from "@/features/projects/components/project-setup-tabs";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (project: any) => void; // for handling success in parent
}

export const CreateProjectDialog = ({ open, onOpenChange, onSuccess }: CreateProjectDialogProps) => {
  const handleSuccess = (project: any) => {
    onSuccess?.(project);
    onOpenChange(false); // close dialog
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle className="text-2xl font-bold">
            Create new project
          </DialogTitle>
        </DialogHeader>
        <div>
          <ProjectSetupTabs onSuccess={handleSuccess} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateProjectDialog;
