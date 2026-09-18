import { z } from "zod";

export const severitySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof severitySchema>;

export const alertStatusSchema = z.enum(["firing", "resolved"]);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

export const incidentStatusSchema = z.enum(["open", "resolved"]);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const serviceSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "id must be a lowercase slug"),
  name: z.string().min(1),
});
export type Service = z.infer<typeof serviceSchema>;

export const alertSchema = z.object({
  id: z.string().min(1),
  serviceId: z.string().min(1),
  summary: z.string().min(1),
  severity: severitySchema,
  status: alertStatusSchema,
  firedAt: z.date(),
});
export type Alert = z.infer<typeof alertSchema>;

export const incidentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  serviceId: z.string().min(1),
  severity: severitySchema,
  status: incidentStatusSchema,
  openedAt: z.date(),
  resolvedAt: z.date().nullable(),
});
export type Incident = z.infer<typeof incidentSchema>;
