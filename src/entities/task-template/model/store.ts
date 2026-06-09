/**
 * Task-templates query-cache layer (catique-1).
 *
 * Keys:
 *   - `taskTemplatesKeys.all` — the full list (picker + management).
 *   - `taskTemplatesKeys.detail(id)` — single template.
 *
 * Mutations invalidate `all`; `EventsProvider` invalidates the same key
 * on the `task_template:*` realtime events.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createTaskTemplate,
  deleteTaskTemplate,
  getTaskTemplate,
  listTaskTemplates,
  updateTaskTemplate,
  type CreateTaskTemplateArgs,
  type UpdateTaskTemplateArgs,
} from "../api";
import type { TaskTemplate } from "./types";

export const taskTemplatesKeys = {
  all: ["taskTemplates"] as const,
  detail: (id: string) => ["taskTemplates", "detail", id] as const,
};

/** `useTaskTemplates` — every template, position-ordered. */
export function useTaskTemplates(): UseQueryResult<TaskTemplate[], Error> {
  return useQuery({
    queryKey: taskTemplatesKeys.all,
    queryFn: listTaskTemplates,
  });
}

/** `useTaskTemplate` — single template by id. */
export function useTaskTemplate(
  id: string,
): UseQueryResult<TaskTemplate, Error> {
  return useQuery({
    queryKey: taskTemplatesKeys.detail(id),
    queryFn: () => getTaskTemplate(id),
    enabled: id.length > 0,
  });
}

/** `useCreateTaskTemplateMutation` — add a template; invalidate the list. */
export function useCreateTaskTemplateMutation(): UseMutationResult<
  TaskTemplate,
  Error,
  CreateTaskTemplateArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaskTemplate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskTemplatesKeys.all });
    },
  });
}

/** `useUpdateTaskTemplateMutation` — edit; invalidate list + detail. */
export function useUpdateTaskTemplateMutation(): UseMutationResult<
  TaskTemplate,
  Error,
  UpdateTaskTemplateArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTaskTemplate,
    onSuccess: (tmpl) => {
      void queryClient.invalidateQueries({ queryKey: taskTemplatesKeys.all });
      void queryClient.invalidateQueries({
        queryKey: taskTemplatesKeys.detail(tmpl.id),
      });
    },
  });
}

/** `useDeleteTaskTemplateMutation` — remove; invalidate the list. */
export function useDeleteTaskTemplateMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTaskTemplate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskTemplatesKeys.all });
    },
  });
}
