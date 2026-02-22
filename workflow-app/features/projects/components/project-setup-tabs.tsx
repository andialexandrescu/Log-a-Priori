"use client";

import { useState } from "react";
import { useCreateProject } from "../api/use-create-project";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createProjectSchema } from "../schemas";
import { useForm } from "react-hook-form";
import { Chakra_Petch } from 'next/font/google';
import { CreateMembersBulkSelect } from "./create-members-bulk-select";
import { ProjectRoleType } from "../constants";

const chakraPetch = Chakra_Petch({ subsets: ['latin'], weight: ['400', '700'] });

const steps = ["Details", "Invite for collaboration", "Review"];
const gridCols = `grid-cols-${steps.length}`;

interface ProjectSetupTabsProps {
  onSuccess?: (project: any) => void;
}

export const ProjectSetupTabs = ({ onSuccess }: ProjectSetupTabsProps) => {
  const [members, setMembers] = useState<{ userId: string; role: ProjectRoleType }[]>([]); // collect members locally

  const [currentStep, setCurrentStep] = useState(0);
  const progress = ((currentStep + 1) / steps.length) * 100;

  const handlePrevious = () => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  };

  const handleNext = () => {
    setCurrentStep(Math.min(currentStep + 1, steps.length - 1));
  };

  const { mutate, isPending } = useCreateProject();

  const form = useForm<z.infer<typeof createProjectSchema>>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const onSubmit = (values: z.infer<typeof createProjectSchema>) => {
    mutate(
      { 
        project: values,
        members
      },
      {
        onSuccess: (data) => {
          onSuccess?.(data);
        },
        onError: (error) => {
          console.error("Project creation failed:", error);
        }
      }
    );
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-xl mx-auto p-6 space-y-6">
      <Progress value={progress} className="w-full" />

      <Tabs value={`${currentStep}`} onValueChange={(value) => setCurrentStep(parseInt(value))} className="w-full">
        <TabsList className={`grid w-full ${gridCols}`}>
          {steps.map((step, index) => (
            <TabsTrigger key={step} value={`${index}`} disabled={false}>
              {step}
            </TabsTrigger>
          ))}
        </TabsList>

        {steps.map((_, index) => (
          <TabsContent key={index} value={`${index}`}>
            <Card variant="glass">
              <CardHeader>
                <CardTitle className={`${chakraPetch.className} text-4xl`}>{steps[index]}</CardTitle>
              </CardHeader>

              <CardContent>
                {index === 0 && (
                  <div className="space-y-4">
                    <div>
                      <Label className="block text-sm mb-1">Project name</Label>
                      <Input className="w-full border p-2 rounded" type="text" {...form.register("name")}/>
                      {form.formState.errors.name && (
                        <p className="text-red-500 text-xs mt-1">{form.formState.errors.name.message}</p>
                      )}
                    </div>

                    <div>
                      <Label className="block text-sm mb-1">Description</Label>
                      <Input className="w-full border p-2 rounded" {...form.register("description")}/>
                      {form.formState.errors.name && (
                        <p className="text-red-500 text-xs mt-1">{form.formState.errors.name.message}</p>
                      )}
                    </div>
                  </div>
                )}

                {index === 1 && (
                  <CreateMembersBulkSelect members={members} setMembers={setMembers} />
                )}

                {index === 2 && (
                  <div className="space-y-2">
                    <p>Review all settings</p>
                    <div className="text-sm text-muted-foreground">
                      <p>Name: {form.watch("name") || "-"}</p>
                      <p>Description: {form.watch("description") || "-"}</p>
                      <p>Members ({members.length}):</p>
                      <ul className="list-disc list-inside">
                        {members.map((m, i) => (
                          <li key={i}>{m.userId} - {m.role}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>

              <CardFooter className="flex justify-between">
                <Button variant="glass" onClick={handlePrevious} disabled={currentStep === 0 || isPending}>
                  Previous
                </Button>

                {currentStep < steps.length - 1 ? (
                  <Button variant="glass" onClick={handleNext} disabled={isPending}>
                    Next
                  </Button>
                ) : (
                  <Button variant="glass" type="submit" disabled={isPending}>
                    {isPending ? "Creating..." : "Create Project"}
                  </Button>
                )}
              </CardFooter>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </form>
  );
};

export default ProjectSetupTabs;
