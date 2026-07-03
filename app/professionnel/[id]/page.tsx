"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import {
  AlertBanner,
  Badge,
  type BadgeTone,
  buttonClass,
  EmptyState,
  getAssignmentRequestStatus,
  SectionCard,
  StatCard,
} from "@/components/ui/index";
import { supabase } from "@/lib/supabaseClient";
import { isSuperAdmin } from "@/lib/superAdmin";
import {
  getAssignmentRequestMetrics,
  getServiceTakenCount,
  getUsedAssignmentCount,
  logAudit,
  logAssignedClientStatusChange,
} from "../shared";

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  professional_title: string | null;
  professional_phone: string | null;
  professional_license_number: string | null;
  pref_client_types: string[] | null;
  pref_modalities: string[] | null;
  pref_followup_types: string[] | null;
  pref_notes: string | null;
};

type AssignmentRequest = {
  id: string;
  professional_id: string;
  is_active: boolean | null;
  requested_count: number | null;
  assigned_count: number | null;
  remaining_count: number | null;
  request_comment: string | null;
  created_at?: string | null;
};

type AssignedClient = {
  id: string;
  assignment_request_id: string | null;
  waiting_list_client_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  requester_name: string | null;
  assigned_date: string | null;
  contacted: boolean | null;
  is_active: boolean | null;
  meeting_count: number | null;
  dossier_closed: boolean | null;
  closure_reason: string | null;
  short_comment: string | null;
  meeting_modality: string | null;
  service_address: string | null;
};

type AssignedClientStatusHistory = {
  id: string;
  assigned_client_id: string;
  previous_status: boolean | null;
  new_status: boolean | null;
  changed_by_profile_id: string | null;
  changed_by_role: string | null;
  changed_by_name: string | null;
  changed_at: string | null;
};

type AuditActor = {
  id: string;
  role: string | null;
  name: string | null;
};

type WaitingListClient = {
  id: string;
  created_at: string | null;
  contact_date: string | null;
  status: string | null;
  priority_level: string | null;
  service_requested: string | null;
  client_name: string | null;
  first_requester_name: string | null;
  second_requester_name: string | null;
  city: string | null;
  meeting_modality: string | null;
  availability: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  consultation_reason: string | null;
};

type ProfessionalProfileForm = {
  full_name: string;
  email: string;
  professional_title: string;
  professional_phone: string;
  professional_license_number: string;
  pref_client_types: string;
  pref_modalities: string;
  pref_followup_types: string;
  pref_notes: string;
};

const HISTORY_PAGE_SIZE = 5;
const ASSIGNED_CLIENTS_PAGE_SIZE = 4;
const WAITING_LIST_RESULT_LIMIT = 5;
const waitingListPriorityOrder: Record<string, number> = {
  urgent: 0,
  existing_or_transfer: 1,
  normal: 2,
};
const cancelAssignmentReasons = [
  "Mauvais professionnel",
  "Mauvais client",
  "Doublon",
  "Erreur administrative",
  "Client déjà pris en charge",
  "Autre",
];

const emptyProfessionalProfileForm: ProfessionalProfileForm = {
  full_name: "",
  email: "",
  professional_title: "",
  professional_phone: "",
  professional_license_number: "",
  pref_client_types: "",
  pref_modalities: "",
  pref_followup_types: "",
  pref_notes: "",
};

function formatBoolean(value: boolean | null): string {
  return value ? "Oui" : "Non";
}

function formatText(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) {
    const joinedValue = value
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .join(", ");

    return joinedValue || "-";
  }

  return value?.trim() || "-";
}

function getClientName(client: AssignedClient): string {
  const fullName = [client.first_name, client.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || "-";
}

function getWaitingClientRequester(client: WaitingListClient): string {
  return (
    [client.first_requester_name, client.second_requester_name]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" / ") || "-"
  );
}

function getWaitingClientContact(client: WaitingListClient): string {
  return (
    [client.contact_phone, client.contact_email]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" / ") || "-"
  );
}

function splitClientName(clientName: string | null): {
  firstName: string;
  lastName: string;
} {
  const nameParts = clientName?.trim().split(/\s+/).filter(Boolean) ?? [];

  if (nameParts.length === 0) {
    return { firstName: "Client", lastName: "liste d'attente" };
  }

  if (nameParts.length === 1) {
    return { firstName: nameParts[0], lastName: "-" };
  }

  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(" "),
  };
}

function normalizeSearchValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function getWaitingClientSortValue(client: WaitingListClient): number {
  const fallbackDate = client.contact_date ?? client.created_at;

  if (!fallbackDate) return Number.MAX_SAFE_INTEGER;

  const date = new Date(
    fallbackDate.includes("T") ? fallbackDate : `${fallbackDate}T00:00:00`,
  );

  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

async function recalculateAssignmentRequest(requestId: string): Promise<void> {
  const { data: request, error: requestError } = await supabase
    .from("assignment_requests")
    .select("requested_count")
    .eq("id", requestId)
    .limit(1)
    .maybeSingle();

  if (requestError || !request) return;

  const { data: assignedClients, error: assignedClientsError } = await supabase
    .from("assigned_clients")
    .select("is_active")
    .eq("assignment_request_id", requestId)
    .is("canceled_at", null);

  if (assignedClientsError || !assignedClients) return;

  const assignedCount = getServiceTakenCount(assignedClients);
  const occupiedCount = getUsedAssignmentCount(assignedClients);
  const requestedCount = Math.max(request.requested_count ?? 0, 0);
  const remainingCount = Math.max(requestedCount - occupiedCount, 0);
  const isActive = assignedCount < requestedCount;

  await supabase
    .from("assignment_requests")
    .update({
      assigned_count: assignedCount,
      remaining_count: remainingCount,
      is_active: isActive,
    })
    .eq("id", requestId);
}

async function getFreshActiveAssignmentRequest(
  professionalId: string,
): Promise<AssignmentRequest | null> {
  const { data: requests, error: requestsError } = await supabase
    .from("assignment_requests")
    .select(
      "id, professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment, created_at",
    )
    .eq("professional_id", professionalId)
    .eq("is_active", true)
    .gt("requested_count", 0)
    .order("created_at", { ascending: false });

  if (requestsError) throw requestsError;

  const activeRequests = (requests ?? []) as AssignmentRequest[];
  const requestIds = activeRequests.map((request) => request.id);

  if (requestIds.length === 0) return null;

  const { data: assignedClients, error: assignedClientsError } = await supabase
    .from("assigned_clients")
    .select("assignment_request_id, is_active")
    .in("assignment_request_id", requestIds)
    .is("canceled_at", null);

  if (assignedClientsError) throw assignedClientsError;

  const serviceTakenCountByRequestId = new Map<string, number>();
  const occupiedCountByRequestId = new Map<string, number>();

  (
    (assignedClients ?? []) as Array<{
      assignment_request_id: string | null;
      is_active: boolean | null;
    }>
  ).forEach((client) => {
    if (!client.assignment_request_id) return;

    if (client.is_active === true) {
      serviceTakenCountByRequestId.set(
        client.assignment_request_id,
        (serviceTakenCountByRequestId.get(client.assignment_request_id) ?? 0) + 1,
      );
      occupiedCountByRequestId.set(
        client.assignment_request_id,
        (occupiedCountByRequestId.get(client.assignment_request_id) ?? 0) + 1,
      );
    } else if (client.is_active === null) {
      occupiedCountByRequestId.set(
        client.assignment_request_id,
        (occupiedCountByRequestId.get(client.assignment_request_id) ?? 0) + 1,
      );
    }
  });

  return (
    activeRequests
      .map((request) => {
        const requestedCount = Math.max(request.requested_count ?? 0, 0);
        const assignedCount = serviceTakenCountByRequestId.get(request.id) ?? 0;
        const occupiedCount = occupiedCountByRequestId.get(request.id) ?? 0;
        const remainingCount = Math.max(requestedCount - occupiedCount, 0);

        return {
          ...request,
          assigned_count: assignedCount,
          remaining_count: remainingCount,
        };
      })
      .find((request) => {
        const requestedCount = Math.max(request.requested_count ?? 0, 0);
        return (
          requestedCount > 0 &&
          (request.assigned_count ?? 0) < requestedCount &&
          (request.remaining_count ?? 0) > 0
        );
      }) ?? null
  );
}

function getWaitingClientPrioritySortValue(client: WaitingListClient): number {
  return (
    waitingListPriorityOrder[client.priority_level ?? ""] ??
    Number.MAX_SAFE_INTEGER
  );
}

function sortWaitingClientsByPriority(
  firstClient: WaitingListClient,
  secondClient: WaitingListClient,
): number {
  const priorityDifference =
    getWaitingClientPrioritySortValue(firstClient) -
    getWaitingClientPrioritySortValue(secondClient);

  if (priorityDifference !== 0) return priorityDifference;

  return (
    getWaitingClientSortValue(firstClient) -
    getWaitingClientSortValue(secondClient)
  );
}

function getServiceStatus(client: AssignedClient): {
  label: string;
  tone: BadgeTone;
} {
  if (client.is_active === true) {
    return { label: "Service pris", tone: "success" };
  }

  if (client.is_active === false) {
    return { label: "Service non pris", tone: "danger" };
  }

  return { label: "En attente", tone: "warning" };
}

function getAuditStatusLabel(value: boolean | null): string {
  if (value === true) return "Service pris";
  if (value === false) return "Service non pris";
  return "En attente";
}

function getAuditRoleLabel(value: string | null): string {
  if (value === "direction") return "Direction";
  if (value === "professionnel") return "Professionnel";
  return "Utilisateur";
}

function shouldShowServiceAddress(client: AssignedClient): boolean {
  return (
    client.meeting_modality?.toLowerCase().includes("domicile") === true &&
    Boolean(client.service_address?.trim())
  );
}

function nullableText(value: string): string | null {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function arrayToTextareaValue(value: string[] | null): string {
  return value?.join(", ") ?? "";
}

function textareaValueToArray(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getTodayDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";

  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Une erreur est survenue lors du chargement.";
}

export default function ProfessionnelDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const professionalIdRaw = params?.id;
  const professionalId =
    typeof professionalIdRaw === "string"
      ? professionalIdRaw
      : Array.isArray(professionalIdRaw)
        ? professionalIdRaw[0]
        : "";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [auditActor, setAuditActor] = useState<AuditActor | null>(null);
  const [canUseSuperAdminActions, setCanUseSuperAdminActions] =
    useState(false);
  const [assignmentRequest, setAssignmentRequest] =
    useState<AssignmentRequest | null>(null);
  const [assignedClients, setAssignedClients] = useState<AssignedClient[]>([]);
  const [statusHistoryByClientId, setStatusHistoryByClientId] = useState<
    Record<string, AssignedClientStatusHistory[]>
  >({});
  const [waitingListClients, setWaitingListClients] = useState<WaitingListClient[]>(
    [],
  );
  const [historicalClients, setHistoricalClients] = useState<AssignedClient[]>(
    [],
  );
  const [waitingListSearch, setWaitingListSearch] = useState("");
  const [showClientHistory, setShowClientHistory] = useState(false);
  const [assignedClientsPage, setAssignedClientsPage] = useState(0);
  const [deletingAssignmentRequest, setDeletingAssignmentRequest] =
    useState(false);
  const [deletingAssignedClientId, setDeletingAssignedClientId] = useState("");
  const [resendingProfessionalEmailId, setResendingProfessionalEmailId] =
    useState("");
  const [resendingClientEmailId, setResendingClientEmailId] = useState("");
  const [cancelingAssignedClientId, setCancelingAssignedClientId] =
    useState("");
  const [cancelAssignmentClient, setCancelAssignmentClient] =
    useState<AssignedClient | null>(null);
  const [cancelAssignmentReason, setCancelAssignmentReason] = useState("");
  const [cancelAssignmentOtherReason, setCancelAssignmentOtherReason] =
    useState("");
  const [clientHistoryPage, setClientHistoryPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [professionalProfileForm, setProfessionalProfileForm] =
    useState<ProfessionalProfileForm>(emptyProfessionalProfileForm);
  const [savingProfessionalProfile, setSavingProfessionalProfile] =
    useState(false);
  const [professionalProfileMessage, setProfessionalProfileMessage] =
    useState<string | null>(null);
  const [professionalProfileError, setProfessionalProfileError] =
    useState<string | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [notifyProfessional, setNotifyProfessional] = useState(false);
  const [notifyClient, setNotifyClient] = useState(false);

  const professionalName = useMemo(
    () => profile?.full_name?.trim() || "Professionnel",
    [profile],
  );
  const loadProfessionalProfile = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading ?? true;

      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      let isRedirecting = false;

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          isRedirecting = true;
          router.push("/login");
          return;
        }

        const { data: currentProfile, error: currentProfileError } =
          await supabase
            .from("profiles")
            .select("role, full_name, email")
            .eq("id", user.id)
            .limit(1)
            .maybeSingle();

        if (currentProfileError || currentProfile?.role !== "direction") {
          isRedirecting = true;
          router.push("/");
          return;
        }

        setAuditActor({
          id: user.id,
          role: currentProfile.role,
          name: currentProfile.full_name ?? currentProfile.email ?? null,
        });
        setCanUseSuperAdminActions(isSuperAdmin(user, currentProfile));

        const profileResponse = await supabase
          .from("profiles")
          .select(
            "id, full_name, email, professional_title, professional_phone, professional_license_number, pref_client_types, pref_modalities, pref_followup_types, pref_notes",
          )
          .eq("id", professionalId)
          .limit(1)
          .maybeSingle();

        if (profileResponse.error) throw profileResponse.error;
        if (!profileResponse.data) {
          throw new Error("Profil professionnel introuvable.");
        }

        const [requestsResponse, clientsResponse, waitingListResponse] =
          await Promise.all([
          supabase
            .from("assignment_requests")
            .select(
              "id, professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment, created_at",
            )
            .eq("professional_id", professionalId)
            .order("created_at", { ascending: false }),
          supabase
            .from("assigned_clients")
            .select(
              "id, assignment_request_id, waiting_list_client_id, first_name, last_name, email, phone, requester_name, assigned_date, contacted, is_active, meeting_count, dossier_closed, closure_reason, short_comment, meeting_modality, service_address",
            )
            .eq("professional_id", professionalId)
            .is("canceled_at", null)
            .order("assigned_date", { ascending: false }),
          supabase
            .from("waiting_list_clients")
            .select(
              "id, created_at, contact_date, status, priority_level, service_requested, client_name, first_requester_name, second_requester_name, city, meeting_modality, availability, contact_email, contact_phone, consultation_reason",
            )
            .eq("status", "waiting")
            .order("contact_date", { ascending: true }),
        ]);

        if (requestsResponse.error) throw requestsResponse.error;
        if (clientsResponse.error) throw clientsResponse.error;
        if (waitingListResponse.error) throw waitingListResponse.error;

        const loadedRequests =
          (requestsResponse.data ?? []) as AssignmentRequest[];
        const loadedClients = (clientsResponse.data ?? []) as AssignedClient[];
        const loadedClientIds = loadedClients.map((client) => client.id);
        const statusHistoryByClient = new Map<
          string,
          AssignedClientStatusHistory[]
        >();

        if (loadedClientIds.length > 0) {
          const { data: statusHistoryData, error: statusHistoryError } =
            await supabase
              .from("assigned_client_status_history")
              .select(
                "id, assigned_client_id, previous_status, new_status, changed_by_profile_id, changed_by_role, changed_by_name, changed_at",
              )
              .in("assigned_client_id", loadedClientIds)
              .order("changed_at", { ascending: false });

          if (statusHistoryError) {
            console.error(
              "[assigned-client-status-history] Impossible de charger l'historique:",
              statusHistoryError.message,
            );
          } else {
            ((statusHistoryData ?? []) as AssignedClientStatusHistory[]).forEach(
              (historyRow) => {
                const rows =
                  statusHistoryByClient.get(historyRow.assigned_client_id) ?? [];
                if (rows.length < 10) {
                  rows.push(historyRow);
                  statusHistoryByClient.set(historyRow.assigned_client_id, rows);
                }
              },
            );
          }
        }

        const clientsByRequestId = new Map<string, AssignedClient[]>();

        loadedClients.forEach((client) => {
          if (!client.assignment_request_id) return;

          const requestClients =
            clientsByRequestId.get(client.assignment_request_id) ?? [];
          requestClients.push(client);
          clientsByRequestId.set(client.assignment_request_id, requestClients);
        });

        const activeRequest =
          loadedRequests.find((request) => {
            const requestClients = clientsByRequestId.get(request.id) ?? [];
            const serviceTakenCount = getServiceTakenCount(requestClients);
            const occupiedCount = getUsedAssignmentCount(requestClients);

            return getAssignmentRequestMetrics({
              isActive: request.is_active,
              requestedCount: request.requested_count,
              acceptedCount: serviceTakenCount,
              occupiedCount,
              remainingCount: Math.max(
                (request.requested_count ?? 0) - occupiedCount,
                0,
              ),
            }).isActive;
          }) ?? null;

        const loadedProfile = profileResponse.data as Profile;

        setProfile(loadedProfile);
        setProfessionalProfileForm({
          full_name: loadedProfile.full_name ?? "",
          email: loadedProfile.email ?? "",
          professional_title: loadedProfile.professional_title ?? "",
          professional_phone: loadedProfile.professional_phone ?? "",
          professional_license_number:
            loadedProfile.professional_license_number ?? "",
          pref_client_types: arrayToTextareaValue(loadedProfile.pref_client_types),
          pref_modalities: arrayToTextareaValue(loadedProfile.pref_modalities),
          pref_followup_types: arrayToTextareaValue(
            loadedProfile.pref_followup_types,
          ),
          pref_notes: loadedProfile.pref_notes ?? "",
        });
        setAssignmentRequest(activeRequest);
        setAssignedClients(loadedClients);
        setHistoricalClients(loadedClients);
        setStatusHistoryByClientId(Object.fromEntries(statusHistoryByClient));
        setWaitingListClients(
          ((waitingListResponse.data ?? []) as WaitingListClient[]).sort(
            sortWaitingClientsByPriority,
          ),
        );
      } catch (caughtError: unknown) {
        setError(getErrorMessage(caughtError));
      } finally {
        if (showLoading && !isRedirecting) {
          setLoading(false);
        }
      }
    },
    [professionalId, router],
  );

  useEffect(() => {
    let cancelled = false;

    if (!professionalId) {
      setError("ID manquant dans l'URL.");
      setLoading(false);
      return;
    }

    async function loadInitialData() {
      await loadProfessionalProfile();

      if (cancelled) {
        return;
      }
    }

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [loadProfessionalProfile, professionalId]);

  useEffect(() => {
    setClientHistoryPage(0);
  }, [historicalClients.length, showClientHistory]);

  useEffect(() => {
    setAssignedClientsPage(0);
  }, [assignedClients.length]);

  const handleProfessionalProfileFormChange = (
    field: keyof ProfessionalProfileForm,
    value: string,
  ) => {
    setProfessionalProfileForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  };

  const handleSaveProfessionalProfile = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setProfessionalProfileMessage(null);
    setProfessionalProfileError(null);
    setSavingProfessionalProfile(true);

    try {
      const { data: updatedProfile, error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: nullableText(professionalProfileForm.full_name),
          email: nullableText(professionalProfileForm.email),
          professional_title: nullableText(
            professionalProfileForm.professional_title,
          ),
          professional_phone: nullableText(
            professionalProfileForm.professional_phone,
          ),
          professional_license_number: nullableText(
            professionalProfileForm.professional_license_number,
          ),
          pref_client_types: textareaValueToArray(
            professionalProfileForm.pref_client_types,
          ),
          pref_modalities: textareaValueToArray(
            professionalProfileForm.pref_modalities,
          ),
          pref_followup_types: textareaValueToArray(
            professionalProfileForm.pref_followup_types,
          ),
          pref_notes: nullableText(professionalProfileForm.pref_notes),
        })
        .eq("id", professionalId)
        .select(
          "id, full_name, email, professional_title, professional_phone, professional_license_number, pref_client_types, pref_modalities, pref_followup_types, pref_notes",
        )
        .limit(1)
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updatedProfile) {
        throw new Error("Profil professionnel introuvable.");
      }

      const nextProfile = updatedProfile as Profile;
      setProfile(nextProfile);
      setProfessionalProfileForm({
        full_name: nextProfile.full_name ?? "",
        email: nextProfile.email ?? "",
        professional_title: nextProfile.professional_title ?? "",
        professional_phone: nextProfile.professional_phone ?? "",
        professional_license_number:
          nextProfile.professional_license_number ?? "",
        pref_client_types: arrayToTextareaValue(nextProfile.pref_client_types),
        pref_modalities: arrayToTextareaValue(nextProfile.pref_modalities),
        pref_followup_types: arrayToTextareaValue(
          nextProfile.pref_followup_types,
        ),
        pref_notes: nextProfile.pref_notes ?? "",
      });
      setProfessionalProfileMessage("Informations sauvegardées.");
    } catch (caughtError: unknown) {
      setProfessionalProfileError(getErrorMessage(caughtError));
    } finally {
      setSavingProfessionalProfile(false);
    }
  };

  const getPendingAssignmentCount = async (
    selectedProfessionalId: string,
  ): Promise<number | null> => {
    const { count, error: countError } = await supabase
      .from("assigned_clients")
      .select("id", { count: "exact", head: true })
      .eq("professional_id", selectedProfessionalId)
      .is("is_active", null)
      .is("canceled_at", null);

    if (countError) {
      console.error(
        "[professional-assignment-notification] Impossible de compter les assignations en attente:",
        countError,
      );
      return null;
    }

    return count ?? 0;
  };

  const sendProfessionalAssignmentNotification = async ({
    selectedProfessionalId,
    previousPendingCount,
  }: {
    selectedProfessionalId: string;
    previousPendingCount: number | null;
  }): Promise<boolean> => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      console.error(
        "[professional-assignment-notification] Session introuvable pour l'envoi.",
        sessionError,
      );
      return false;
    }

    try {
      console.log("[professional-assignment-notification] Appel route:", {
        professionalId: selectedProfessionalId,
        pendingBefore: previousPendingCount,
      });

      const response = await fetch(
        "/api/direction/professional-assignment-notification",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            professionalId: selectedProfessionalId,
            previousPendingCount,
          }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | {
            error?: string;
            skipped?: boolean;
            reason?: string;
            pendingBefore?: number | null;
            pendingAfter?: number;
          }
        | null;

      console.log("[professional-assignment-notification] Réponse route:", {
        professionalId: selectedProfessionalId,
        status: response.status,
        ok: response.ok,
        skipped: result?.skipped ?? false,
        reason: result?.reason ?? null,
        pendingBefore: result?.pendingBefore ?? previousPendingCount,
        pendingAfter: result?.pendingAfter ?? null,
      });

      if (!response.ok) {
        console.error(
          "[professional-assignment-notification] Échec de l'envoi:",
          result?.error ?? response.statusText,
        );
        return false;
      }

      return true;
    } catch (notificationError) {
      console.error(
        "[professional-assignment-notification] Erreur réseau pendant l'envoi:",
        notificationError,
      );
      return false;
    }
  };

  const sendClientAssignmentNotification = async (
    assignedClientId: string,
  ): Promise<boolean> => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      console.error(
        "[client-assignment-notification] Session introuvable pour l'envoi.",
        sessionError,
      );
      return false;
    }

    try {
      console.log("[client-assignment-notification] Appel route:", {
        assignedClientId,
      });

      const response = await fetch(
        "/api/direction/client-assignment-notification",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ assignedClientId }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | {
            error?: string;
            skipped?: boolean;
            reason?: string;
          }
        | null;

      console.log("[client-assignment-notification] Reponse route:", {
        assignedClientId,
        status: response.status,
        ok: response.ok,
        skipped: result?.skipped ?? false,
        reason: result?.reason ?? null,
      });

      if (!response.ok) {
        console.error(
          "[client-assignment-notification] Echec de l'envoi:",
          result?.error ?? response.statusText,
        );
        return false;
      }

      return true;
    } catch (notificationError) {
      console.error(
        "[client-assignment-notification] Erreur reseau pendant l'envoi:",
        notificationError,
      );
      return false;
    }
  };

  const getSessionToken = async (): Promise<string> => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error("Session introuvable. Veuillez vous reconnecter.");
    }

    return session.access_token;
  };

  const handleResendProfessionalAssignmentNotification = async (
    client: AssignedClient,
  ) => {
    setClientMessage(null);
    setClientError(null);
    setResendingProfessionalEmailId(client.id);

    try {
      const accessToken = await getSessionToken();
      const response = await fetch(
        "/api/direction/resend-professional-assignment-notification",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ assignedClientId: client.id }),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | { error?: string; skipped?: boolean; reason?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          result?.error ?? "Impossible de renvoyer le courriel professionnel.",
        );
      }

      if (result?.skipped) {
        setClientMessage(
          result.reason === "platform_access_disabled"
            ? "Courriel professionnel non envoyé : accès plateforme désactivé."
            : "Courriel professionnel non envoyé.",
        );
        return;
      }

      setClientMessage("Courriel professionnel renvoyé.");
    } catch (caughtError: unknown) {
      setClientError(getErrorMessage(caughtError));
    } finally {
      setResendingProfessionalEmailId("");
    }
  };

  const handleResendClientAssignmentNotification = async (
    client: AssignedClient,
  ) => {
    setClientMessage(null);
    setClientError(null);
    setResendingClientEmailId(client.id);

    try {
      const accessToken = await getSessionToken();
      const response = await fetch(
        "/api/direction/resend-client-assignment-notification",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ assignedClientId: client.id }),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | { error?: string; skipped?: boolean; reason?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          result?.error ?? "Impossible de renvoyer le courriel client.",
        );
      }

      if (result?.skipped) {
        setClientMessage("Courriel client non envoyé : aucun courriel disponible.");
        return;
      }

      setClientMessage("Courriel client renvoyé.");
    } catch (caughtError: unknown) {
      setClientError(getErrorMessage(caughtError));
    } finally {
      setResendingClientEmailId("");
    }
  };

  const openCancelAssignmentDialog = (client: AssignedClient) => {
    setClientMessage(null);
    setClientError(null);
    setCancelAssignmentClient(client);
    setCancelAssignmentReason("");
    setCancelAssignmentOtherReason("");
  };

  const closeCancelAssignmentDialog = () => {
    if (cancelingAssignedClientId) return;

    setCancelAssignmentClient(null);
    setCancelAssignmentReason("");
    setCancelAssignmentOtherReason("");
  };

  const handleCancelAssignment = async () => {
    if (!cancelAssignmentClient) return;

    setClientMessage(null);
    setClientError(null);

    if (!cancelAssignmentReason) {
      setClientError("Veuillez sélectionner un motif d’annulation.");
      return;
    }

    if (
      cancelAssignmentReason === "Autre" &&
      cancelAssignmentOtherReason.trim().length === 0
    ) {
      setClientError("Veuillez préciser le motif d’annulation.");
      return;
    }

    setCancelingAssignedClientId(cancelAssignmentClient.id);

    try {
      const accessToken = await getSessionToken();
      const response = await fetch(
        `/api/direction/assigned-clients/${cancelAssignmentClient.id}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reason: cancelAssignmentReason,
            otherReason: cancelAssignmentOtherReason,
          }),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | { error?: string; skipped?: boolean }
        | null;

      if (!response.ok) {
        throw new Error(
          result?.error ?? "Impossible d’annuler cette assignation.",
        );
      }

      setCancelAssignmentClient(null);
      setCancelAssignmentReason("");
      setCancelAssignmentOtherReason("");
      setClientMessage("Assignation annulée.");
      await loadProfessionalProfile({ showLoading: false });
    } catch (caughtError: unknown) {
      setClientError(getErrorMessage(caughtError));
    } finally {
      setCancelingAssignedClientId("");
    }
  };

  const handleDeleteAssignmentRequest = async () => {
    if (!assignmentRequest) return;

    setClientMessage(null);
    setClientError(null);
    setDeletingAssignmentRequest(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("Session introuvable. Veuillez vous reconnecter.");
      }

      const summaryResponse = await fetch(
        `/api/direction/assignment-requests/${assignmentRequest.id}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      const summaryResult = (await summaryResponse.json().catch(() => null)) as
        | {
            error?: string;
            summary?: {
              linkedClients: number;
              serviceTaken: number;
              serviceNotTaken: number;
              pending: number;
            };
          }
        | null;

      if (!summaryResponse.ok) {
        throw new Error(
          summaryResult?.error ?? "Impossible de charger le résumé de la demande.",
        );
      }

      const summary = summaryResult?.summary ?? {
        linkedClients: 0,
        serviceTaken: 0,
        serviceNotTaken: 0,
        pending: 0,
      };
      const confirmed = window.confirm(
        [
          "Supprimer définitivement cette demande ?",
          "",
          `Nombre de clients liés : ${summary.linkedClients}`,
          `Services pris : ${summary.serviceTaken}`,
          `Services non pris : ${summary.serviceNotTaken}`,
          `Services en attente : ${summary.pending}`,
          "",
          "Les assignations liées seront conservées, mais ne seront plus associées à cette demande.",
        ].join("\n"),
      );

      if (!confirmed) return;

      const deleteResponse = await fetch(
        `/api/direction/assignment-requests/${assignmentRequest.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      const deleteResult = (await deleteResponse.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!deleteResponse.ok) {
        throw new Error(
          deleteResult?.error ?? "Impossible de supprimer la demande.",
        );
      }

      setClientMessage("Demande supprimée.");
      await loadProfessionalProfile({ showLoading: false });
    } catch (caughtError: unknown) {
      setClientError(getErrorMessage(caughtError));
    } finally {
      setDeletingAssignmentRequest(false);
    }
  };

  const handleDeleteAssignedClient = async (client: AssignedClient) => {
    const confirmed = window.confirm(
      [
        "Supprimer définitivement cette assignation ?",
        "",
        `Client : ${getClientName(client)}`,
        "",
        "Cette action supprimera l'assignation et remettra le client dans la liste d'attente si un lien existe.",
      ].join("\n"),
    );

    if (!confirmed) return;

    setClientMessage(null);
    setClientError(null);
    setDeletingAssignedClientId(client.id);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("Session introuvable. Veuillez vous reconnecter.");
      }

      const response = await fetch(`/api/direction/assigned-clients/${client.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          result?.error ?? "Impossible de supprimer l'assignation.",
        );
      }

      setClientMessage("Assignation supprimée.");
      await loadProfessionalProfile({ showLoading: false });
    } catch (caughtError: unknown) {
      setClientError(getErrorMessage(caughtError));
    } finally {
      setDeletingAssignedClientId("");
    }
  };

  const handleAssignWaitingClient = async (client: WaitingListClient) => {
    setClientMessage(null);
    setClientError(null);

    setSavingClient(true);

    try {
      const freshAssignmentRequest =
        await getFreshActiveAssignmentRequest(professionalId);

      if (!freshAssignmentRequest?.id) {
        throw new Error(
          "Ce professionnel n’a aucune demande active avec place restante.",
        );
      }

      const previousPendingCount =
        await getPendingAssignmentCount(professionalId);
      const { firstName, lastName } = splitClientName(client.client_name);
      const requesterName = nullableText(getWaitingClientRequester(client));

      const { data: insertedAssignment, error: insertError } = await supabase
        .from("assigned_clients")
        .insert({
          assignment_request_id: freshAssignmentRequest.id,
          waiting_list_client_id: client.id,
          professional_id: professionalId,
          first_name: firstName,
          last_name: lastName,
          email: nullableText(client.contact_email ?? ""),
          phone: nullableText(client.contact_phone ?? ""),
          requester_name: requesterName,
          short_comment: nullableText(client.consultation_reason ?? ""),
          meeting_modality: nullableText(client.meeting_modality ?? ""),
          service_address: nullableText(client.city ?? ""),
          assigned_date: getTodayDate(),
          contacted: false,
          is_active: null,
          dossier_closed: false,
          closure_reason: null,
          meeting_count: 0,
        })
        .select("id")
        .limit(1)
        .maybeSingle();

      if (insertError) throw insertError;
      if (!insertedAssignment?.id) {
        throw new Error(
          "L'assignation a ete creee, mais son identifiant est introuvable.",
        );
      }

      await recalculateAssignmentRequest(freshAssignmentRequest.id);

      const { error: updateWaitingListError } = await supabase
        .from("waiting_list_clients")
        .update({
          status: "assigned",
          assigned_professional_id: professionalId,
          assigned_at: new Date().toISOString(),
        })
        .eq("id", client.id);

      if (updateWaitingListError) throw updateWaitingListError;

      setWaitingListClients((currentClients) =>
        currentClients.filter((currentClient) => currentClient.id !== client.id),
      );
      setClientMessage("Client assigné avec succès.");
      setNotifyProfessional(false);
      setNotifyClient(false);
      await loadProfessionalProfile({ showLoading: false });

      if (auditActor) {
        void logAudit({
          supabase,
          actor: auditActor,
          action: "assignment_created",
          entityType: "assigned_client",
          entityId: insertedAssignment.id,
          description: `Client ${client.client_name ?? "sans nom"} assigné à ${professionalName}.`,
          metadata: {
            client_name: client.client_name,
            professional_name: professionalName,
            requester_name: requesterName,
            client_email: client.contact_email,
            professional_id: professionalId,
            waiting_list_client_id: client.id,
            assignment_request_id: freshAssignmentRequest.id,
            has_assignment_request: true,
          },
        });
      }

      if (notifyProfessional) {
        const notificationSent = await sendProfessionalAssignmentNotification({
          selectedProfessionalId: professionalId,
          previousPendingCount,
        });

        if (auditActor) {
          void logAudit({
            supabase,
            actor: auditActor,
            action: notificationSent
              ? "professional_notification_sent"
              : "professional_notification_failed",
            entityType: "assigned_client",
            entityId: insertedAssignment.id,
            description: notificationSent
              ? `Courriel professionnel envoyé à ${professionalName}.`
              : `Courriel professionnel non envoyé à ${professionalName}.`,
            metadata: {
              client_name: client.client_name,
              professional_name: professionalName,
              professional_id: professionalId,
              notification_type: "professional_assignment",
            },
          });
        }
      } else if (auditActor) {
        void logAudit({
          supabase,
          actor: auditActor,
          action: "professional_notification_not_sent",
          entityType: "assigned_client",
          entityId: insertedAssignment.id,
          description: "Courriel professionnel non envoyé (case décochée).",
          metadata: {
            client_name: client.client_name,
            professional_name: professionalName,
            professional_id: professionalId,
            notification_type: "professional_assignment",
          },
        });
      }

      if (notifyClient && client.contact_email?.trim()) {
        const notificationSent = await sendClientAssignmentNotification(
          insertedAssignment.id,
        );

        if (auditActor) {
          void logAudit({
            supabase,
            actor: auditActor,
            action: notificationSent
              ? "client_notification_sent"
              : "client_notification_failed",
            entityType: "assigned_client",
            entityId: insertedAssignment.id,
            description: notificationSent
              ? `Courriel client envoyé pour ${client.client_name ?? "client sans nom"}.`
              : `Courriel client non envoyé pour ${client.client_name ?? "client sans nom"}.`,
            metadata: {
              client_name: client.client_name,
              professional_name: professionalName,
              client_email: client.contact_email,
              waiting_list_client_id: client.id,
              notification_type: "client_assignment",
            },
          });
        }
      } else if (notifyClient) {
        console.log("[client-assignment-notification] Courriel client absent.", {
          assignedClientId: insertedAssignment.id,
        });
        if (auditActor) {
          void logAudit({
            supabase,
            actor: auditActor,
            action: "client_notification_not_sent",
            entityType: "assigned_client",
            entityId: insertedAssignment.id,
            description: "Courriel client non envoyé (courriel absent).",
            metadata: {
              client_name: client.client_name,
              professional_name: professionalName,
              waiting_list_client_id: client.id,
              notification_type: "client_assignment",
              reason: "missing_email",
            },
          });
        }
      } else if (auditActor) {
        void logAudit({
          supabase,
          actor: auditActor,
          action: "client_notification_not_sent",
          entityType: "assigned_client",
          entityId: insertedAssignment.id,
          description: "Courriel client non envoyé (case décochée).",
          metadata: {
            client_name: client.client_name,
            professional_name: professionalName,
            client_email: client.contact_email,
            waiting_list_client_id: client.id,
            notification_type: "client_assignment",
          },
        });
      }
    } catch (caughtError: unknown) {
      setClientError(getErrorMessage(caughtError));
    } finally {
      setSavingClient(false);
    }
  };

  const handleAssignmentStatusChange = async (
    client: AssignedClient,
    nextStatus: string,
  ) => {
    const nextIsActive =
      nextStatus === "true" ? true : nextStatus === "false" ? false : null;
    const nextWaitingListStatus =
      nextIsActive === true
        ? "active"
        : nextIsActive === false
          ? "closed"
          : "assigned";

    setClientMessage(null);
    setClientError(null);

    try {
      const { error: updateAssignmentError } = await supabase
        .from("assigned_clients")
        .update({ is_active: nextIsActive })
        .eq("id", client.id);

      if (updateAssignmentError) throw updateAssignmentError;

      if (client.waiting_list_client_id) {
        const { error: updateWaitingListError } = await supabase
          .from("waiting_list_clients")
          .update({ status: nextWaitingListStatus })
          .eq("id", client.waiting_list_client_id);

        if (updateWaitingListError) throw updateWaitingListError;
      }

      const updateClient = (currentClient: AssignedClient) =>
        currentClient.id === client.id
          ? { ...currentClient, is_active: nextIsActive }
          : currentClient;

      if (client.assignment_request_id) {
        const nextAssignedClients = assignedClients.map(updateClient);
        const requestClients = nextAssignedClients.filter(
          (currentClient) =>
            currentClient.assignment_request_id === client.assignment_request_id,
        );
        const nextAssignedCount = getServiceTakenCount(requestClients);
        const nextOccupiedCount = getUsedAssignmentCount(requestClients);

        const { data: requestData, error: requestLoadError } = await supabase
          .from("assignment_requests")
          .select("requested_count")
          .eq("id", client.assignment_request_id)
          .limit(1)
          .maybeSingle();

        if (requestLoadError) throw requestLoadError;

        const nextRemainingCount = Math.max(
          (requestData?.requested_count ?? 0) - nextOccupiedCount,
          0,
        );
        const nextRequestIsActive =
          nextAssignedCount < Math.max(requestData?.requested_count ?? 0, 0);

        const { error: requestUpdateError } = await supabase
          .from("assignment_requests")
          .update({
            assigned_count: nextAssignedCount,
            remaining_count: nextRemainingCount,
            is_active: nextRequestIsActive,
          })
          .eq("id", client.assignment_request_id);

        if (requestUpdateError) throw requestUpdateError;

        setAssignmentRequest((currentRequest) =>
          currentRequest?.id === client.assignment_request_id
            ? {
                ...currentRequest,
                assigned_count: nextAssignedCount,
                remaining_count: nextRemainingCount,
                is_active: nextRequestIsActive,
              }
            : currentRequest,
        );
      }

      if (auditActor) {
        void logAssignedClientStatusChange({
          supabase,
          assignedClientId: client.id,
          previousStatus: client.is_active,
          newStatus: nextIsActive,
          actor: auditActor,
        });

        if (client.is_active !== nextIsActive) {
          void logAudit({
            supabase,
            actor: auditActor,
            action: "assignment_status_changed",
            entityType: "assigned_client",
            entityId: client.id,
            description: `${getAuditStatusLabel(client.is_active)} → ${getAuditStatusLabel(nextIsActive)}`,
            metadata: {
              client_name: `${client.first_name} ${client.last_name}`.trim(),
              professional_name: professionalName,
              professional_id: professionalId,
              previous_status: client.is_active,
              new_status: nextIsActive,
            },
          });

          const nextHistoryRow: AssignedClientStatusHistory = {
            id: `local-${client.id}-${Date.now()}`,
            assigned_client_id: client.id,
            previous_status: client.is_active,
            new_status: nextIsActive,
            changed_by_profile_id: auditActor.id,
            changed_by_role: auditActor.role,
            changed_by_name: auditActor.name,
            changed_at: new Date().toISOString(),
          };

          setStatusHistoryByClientId((currentHistory) => ({
            ...currentHistory,
            [client.id]: [
              nextHistoryRow,
              ...(currentHistory[client.id] ?? []),
            ].slice(0, 10),
          }));
        }
      }

      setHistoricalClients((currentClients) => currentClients.map(updateClient));
      setAssignedClients((currentClients) => currentClients.map(updateClient));
      setClientMessage("Statut de l’assignation mis à jour.");
    } catch (caughtError: unknown) {
      setClientError(getErrorMessage(caughtError));
    }
  };

  const activeRequestClients = assignmentRequest
    ? assignedClients.filter(
        (client) => client.assignment_request_id === assignmentRequest.id,
      )
    : [];
  const clientsWithService = activeRequestClients.filter(
    (client) => client.is_active === true,
  );
  const clientsPendingService = activeRequestClients.filter(
    (client) => client.is_active === null,
  );
  const occupiedRequestClientsCount = getUsedAssignmentCount(activeRequestClients);
  const requestMetrics = getAssignmentRequestMetrics({
    isActive: assignmentRequest?.is_active,
    requestedCount: assignmentRequest?.requested_count,
    acceptedCount: clientsWithService.length,
    occupiedCount: occupiedRequestClientsCount,
    remainingCount:
      assignmentRequest && assignmentRequest.requested_count !== null
        ? Math.max(
            (assignmentRequest.requested_count ?? 0) -
              occupiedRequestClientsCount,
            0,
          )
        : assignmentRequest?.remaining_count,
  });
  const requestedCount = requestMetrics.requestedCount;
  const assignedCount = requestMetrics.acceptedCount;
  const remainingCount = requestMetrics.remainingCount;
  const assignmentRequestStatus = getAssignmentRequestStatus({
    isActive: requestMetrics.isActive,
    remainingCount,
    requestedCount,
  });
  const displayAssignmentRequest = assignmentRequest;
  const waitingListSearchValue = normalizeSearchValue(waitingListSearch);
  const canShowWaitingListResults = waitingListSearchValue.length >= 2;
  const matchingWaitingListClients = canShowWaitingListResults
    ? waitingListClients
        .filter((client) =>
          [
            client.client_name,
            client.first_requester_name,
            client.second_requester_name,
            client.contact_email,
            client.contact_phone,
          ].some((value) =>
            normalizeSearchValue(value).includes(waitingListSearchValue),
          ),
        )
        .sort(sortWaitingClientsByPriority)
    : [];
  const filteredWaitingListClients = matchingWaitingListClients.slice(
    0,
    WAITING_LIST_RESULT_LIMIT,
  );
  const assignedClientsPageCount = Math.ceil(
    assignedClients.length / ASSIGNED_CLIENTS_PAGE_SIZE,
  );
  const paginatedAssignedClients = assignedClients.slice(
    assignedClientsPage * ASSIGNED_CLIENTS_PAGE_SIZE,
    assignedClientsPage * ASSIGNED_CLIENTS_PAGE_SIZE + ASSIGNED_CLIENTS_PAGE_SIZE,
  );
  const clientHistoryPageCount = Math.ceil(
    historicalClients.length / HISTORY_PAGE_SIZE,
  );
  const paginatedHistoricalClients = historicalClients.slice(
    clientHistoryPage * HISTORY_PAGE_SIZE,
    clientHistoryPage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE,
  );
  const operationalAlerts = [
    clientsPendingService.length > 0
      ? {
          title: "Assignations en attente",
          description: `${clientsPendingService.length} assignation${
            clientsPendingService.length > 1 ? "s sont" : " est"
          } en attente de confirmation de service.`,
          tone: "warning" as BadgeTone,
        }
      : null,
    assignmentRequestStatus.label === "demande inactive"
      ? {
          title: "Demande inactive",
          description: "Ce professionnel n'a pas de demande active actuellement.",
          tone: "muted" as BadgeTone,
        }
      : null,
    clientsWithService.length === 0
      ? {
          title: "Aucun client ayant pris le service",
          description: "Aucun client actif n'est associé au professionnel.",
          tone: "muted" as BadgeTone,
        }
      : null,
  ].filter(
    (
      alert,
    ): alert is { title: string; description: string; tone: BadgeTone } =>
      Boolean(alert),
  );
  const waitingListAssignmentSection = (
    <div className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[#332820]">
            Assigner un client de la liste d’attente
          </h3>
          <p className="mt-1 text-sm text-[#7a6859]">
            Sélectionner un client en attente et l’assigner à ce professionnel.
          </p>
        </div>
        <label className="block text-sm font-medium text-[#5d4a3d] lg:w-80">
          Rechercher
          <input
            type="search"
            value={waitingListSearch}
            onChange={(event) => setWaitingListSearch(event.target.value)}
            placeholder="Nom, requérant, courriel ou téléphone"
            className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
          />
        </label>
      </div>

      {!displayAssignmentRequest && (
        <p className="mt-4 rounded-xl border border-[#eadfd2] bg-[#fffaf4] px-4 py-3 text-sm text-[#7a6859]">
          Ce professionnel n’a aucune demande active avec place restante.
        </p>
      )}

      {displayAssignmentRequest && (
        <div className="mt-4 rounded-xl border border-[#eadfd2] bg-[#fffdf9] p-4">
          <p className="text-sm font-semibold text-[#332820]">
            Souhaitez-vous envoyer les notifications ?
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-sm text-[#6c5a4d]">
              <input
                type="checkbox"
                checked={notifyProfessional}
                onChange={(event) => setNotifyProfessional(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
              />
              Envoyer un courriel au professionnel
            </label>
            <label className="flex items-start gap-2 text-sm text-[#6c5a4d]">
              <input
                type="checkbox"
                checked={notifyClient}
                onChange={(event) => setNotifyClient(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
              />
              Envoyer un courriel au client
            </label>
          </div>
        </div>
      )}

      {canShowWaitingListResults && (
        <p className="mt-4 text-sm font-medium text-[#7a6859]">
          {matchingWaitingListClients.length} résultat
          {matchingWaitingListClients.length > 1 ? "s" : ""}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {!canShowWaitingListResults ? (
          <p className="rounded-xl border border-[#eadfd2] bg-[#fffdf9] p-4 text-sm text-[#7a6859]">
            Saisir au moins 2 caractères pour afficher les clients.
          </p>
        ) : filteredWaitingListClients.length === 0 ? (
          <EmptyState title="Aucun client en attente trouvé." />
        ) : (
          filteredWaitingListClients.map((client) => (
            <article
              key={client.id}
              className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        client.priority_level === "urgent"
                          ? "danger"
                          : client.priority_level === "existing_or_transfer"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {formatText(client.priority_level)}
                    </Badge>
                    <h4 className="text-base font-semibold text-[#332820]">
                      {formatText(client.client_name)}
                    </h4>
                  </div>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <dt className="font-medium text-[#8a6f5d]">Requérant</dt>
                      <dd className="mt-1 break-words text-[#332820]">
                        {getWaitingClientRequester(client)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-[#8a6f5d]">
                        Date de contact
                      </dt>
                      <dd className="mt-1 text-[#332820]">
                        {formatDate(client.contact_date)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-[#8a6f5d]">Modalité</dt>
                      <dd className="mt-1 text-[#332820]">
                        {formatText(client.meeting_modality)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2 xl:col-span-3">
                      <dt className="font-medium text-[#8a6f5d]">Contact</dt>
                      <dd className="mt-1 break-words text-[#332820]">
                        {getWaitingClientContact(client)}
                      </dd>
                    </div>
                  </dl>
                </div>
                <button
                  type="button"
                  disabled={savingClient || !displayAssignmentRequest}
                  className={`${buttonClass("primary")} whitespace-nowrap`}
                  onClick={() => void handleAssignWaitingClient(client)}
                >
                  {savingClient
                    ? "Assignation..."
                    : "Créer l’assignation"}
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      {clientMessage && (
        <p className="mt-4 text-sm font-medium text-green-700">{clientMessage}</p>
      )}

      {clientError && (
        <p className="mt-4 text-sm font-medium text-red-700">{clientError}</p>
      )}
    </div>
  );

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement des données...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Erreur: {error}
            </div>
          )}

          {!loading && !error && profile && (
            <div className="space-y-8">
              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#9b6a3d]">
                      Fiche operationnelle
                    </p>
                    <h1 className="mt-2 text-3xl font-semibold text-[#332820]">
                      {professionalName}
                    </h1>
                    <p className="mt-2 text-sm text-[#7a6859]">
                      {formatText(profile.email)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {displayAssignmentRequest && (
                      <Badge tone={assignmentRequestStatus.tone}>
                        {assignmentRequestStatus.label}
                      </Badge>
                    )}
                    <Badge tone={remainingCount > 0 ? "warning" : "muted"}>
                      {remainingCount} place{remainingCount > 1 ? "s" : ""} restante
                      {remainingCount > 1 ? "s" : ""}
                    </Badge>
                    <Badge tone="success">
                      {clientsWithService.length} service
                      {clientsWithService.length > 1 ? "s" : ""} pris
                    </Badge>
                    <Badge tone="warning">
                      {clientsPendingService.length} en attente
                    </Badge>
                  </div>
                </div>
              </section>

              <SectionCard
                title="Resume"
                description="Vue rapide des volumes, de la demande et des points à surveiller."
              >
                {displayAssignmentRequest ? (
                  <div className="mb-5 rounded-2xl border border-[#d8b992] bg-[#fff4e8] p-5 shadow-[0_10px_28px_rgba(138,86,51,0.10)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold uppercase text-[#8a5633]">
                          Demande active
                        </p>
                        <h2 className="mt-1 text-2xl font-semibold text-[#332820]">
                          {requestedCount} assignation
                          {requestedCount > 1 ? "s" : ""} demandée
                          {requestedCount > 1 ? "s" : ""}
                        </h2>
                        <p className="mt-2 text-sm text-[#6c5a4d]">
                          Ce professionnel a une demande active de{" "}
                          {requestedCount} assignation
                          {requestedCount > 1 ? "s" : ""}.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] px-4 py-3 text-sm font-semibold text-[#5d4a3d]">
                        {assignedCount} assignation{assignedCount > 1 ? "s" : ""} liée
                        {assignedCount > 1 ? "s" : ""}
                        {" - "}
                        {remainingCount} à combler
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mb-5 rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-5">
                    <p className="text-sm font-medium text-[#7a6859]">
                      Aucune demande active actuellement.
                    </p>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="Assignations demandées"
                    value={requestedCount}
                    helper={
                      displayAssignmentRequest
                        ? "Nombre total demandé"
                        : "Aucune demande active"
                    }
                    priority={displayAssignmentRequest ? "high" : "default"}
                  />
                  <StatCard
                    label="Clients ayant pris le service"
                    value={clientsWithService.length}
                    helper="Service pris = oui"
                  />
                  <StatCard
                    label="Services à confirmer"
                    value={clientsPendingService.length}
                    helper={
                      displayAssignmentRequest
                        ? `${clientsPendingService.length} à confirmer sur ${requestedCount}`
                        : "Aucune demande active"
                    }
                  />
                  {displayAssignmentRequest && (
                    <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
                      <p className="text-sm font-medium text-[#7a6859]">
                        Statut de la demande
                      </p>
                      <div className="mt-3">
                        <Badge tone={assignmentRequestStatus.tone}>
                          {assignmentRequestStatus.label}
                        </Badge>
                      </div>
                      <p className="mt-3 text-xs text-[#8a6f5d]">
                        {remainingCount} place{remainingCount > 1 ? "s" : ""} restante
                        {remainingCount > 1 ? "s" : ""}
                      </p>
                    </div>
                  )}
                </div>

                {canUseSuperAdminActions && displayAssignmentRequest && (
                  <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-red-800">
                          Action Super administrateur
                        </p>
                        <p className="mt-1 text-sm text-red-700">
                          Supprimer cette demande sans supprimer les assignations
                          existantes.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void handleDeleteAssignmentRequest()}
                        disabled={deletingAssignmentRequest}
                      >
                        {deletingAssignmentRequest
                          ? "Suppression..."
                          : "Supprimer la demande"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  {operationalAlerts.length === 0 ? (
                    <EmptyState title="Aucune alerte operationnelle." />
                  ) : (
                    operationalAlerts.map((alert) => (
                      <AlertBanner
                        key={alert.title}
                        title={alert.title}
                        description={alert.description}
                        tone={alert.tone}
                      />
                    ))
                  )}
                </div>
              </SectionCard>

              {waitingListAssignmentSection}

              <SectionCard
                title="Clients"
                description="Liste des clients assignés et ajout rapide d'une nouvelle assignation."
              >
                {assignedClients.length === 0 ? (
                  <EmptyState title="Aucun client assigné pour ce professionnel." />
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {paginatedAssignedClients.map((client) => {
                      const serviceStatus = getServiceStatus(client);
                      const statusHistory = statusHistoryByClientId[client.id] ?? [];

                      return (
                        <article
                          key={client.id}
                          className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-[#332820]">
                                {getClientName(client)}
                              </h3>
                              <p className="mt-1 text-sm text-[#7a6859]">
                                Requérant:{" "}
                                <span className="font-semibold text-[#5d4a3d]">
                                  {formatText(client.requester_name)}
                                </span>
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge tone={serviceStatus.tone}>
                                {serviceStatus.label}
                              </Badge>
                              <Badge
                                tone={client.dossier_closed ? "neutral" : "muted"}
                              >
                                Dossier fermé: {formatBoolean(client.dossier_closed)}
                              </Badge>
                            </div>
                          </div>

                          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <label className="block text-sm font-medium text-[#8a6f5d]">
                                Statut du service
                                <select
                                  value={
                                    client.is_active === true
                                      ? "true"
                                      : client.is_active === false
                                        ? "false"
                                        : "pending"
                                  }
                                  onChange={(event) =>
                                    void handleAssignmentStatusChange(
                                      client,
                                      event.target.value,
                                    )
                                  }
                                  className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                                >
                                  <option value="pending">En attente</option>
                                  <option value="true">Service pris</option>
                                  <option value="false">Service non pris</option>
                                </select>
                              </label>
                            </div>
                            <div>
                              <dt className="text-sm font-medium text-[#8a6f5d]">
                                Courriel
                              </dt>
                              <dd className="mt-1 break-words text-sm text-[#332820]">
                                {formatText(client.email)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-sm font-medium text-[#8a6f5d]">
                                Téléphone
                              </dt>
                              <dd className="mt-1 text-sm text-[#332820]">
                                {formatText(client.phone)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-sm font-medium text-[#8a6f5d]">
                                Modalité de rencontre
                              </dt>
                              <dd className="mt-1 text-sm text-[#332820]">
                                {formatText(client.meeting_modality)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-sm font-medium text-[#8a6f5d]">
                                Date d’assignation
                              </dt>
                              <dd className="mt-1 text-sm text-[#332820]">
                                {formatDate(client.assigned_date)}
                              </dd>
                            </div>
                            {shouldShowServiceAddress(client) && (
                              <div className="sm:col-span-2">
                                <dt className="text-sm font-medium text-[#8a6f5d]">
                                  Adresse complète
                                </dt>
                                <dd className="mt-1 break-words text-sm text-[#332820]">
                                  {formatText(client.service_address)}
                                </dd>
                              </div>
                            )}
                          </dl>

                          <div className="mt-5 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
                            <h4 className="text-sm font-semibold text-[#5d4a3d]">
                              Historique des statuts
                            </h4>
                            {statusHistory.length === 0 ? (
                              <p className="mt-2 text-sm text-[#8a6f5d]">
                                Aucun changement de statut enregistré.
                              </p>
                            ) : (
                              <ul className="mt-3 space-y-3">
                                {statusHistory.map((historyRow) => (
                                  <li
                                    key={historyRow.id}
                                    className="border-l-2 border-[#d8b992] pl-3 text-sm"
                                  >
                                    <p className="font-medium text-[#332820]">
                                      {formatDate(historyRow.changed_at)} —{" "}
                                      {formatText(historyRow.changed_by_name)} (
                                      {getAuditRoleLabel(
                                        historyRow.changed_by_role,
                                      )}
                                      )
                                    </p>
                                    <p className="mt-1 text-[#7a6859]">
                                      {getAuditStatusLabel(
                                        historyRow.previous_status,
                                      )}{" "}
                                      →{" "}
                                      {getAuditStatusLabel(historyRow.new_status)}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="mt-4 rounded-xl border border-[#eadfd2] bg-white p-4">
                            <h4 className="text-sm font-semibold text-[#5d4a3d]">
                              Actions sur l’assignation
                            </h4>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[#dfd0bf] bg-[#fffdf9] px-3 py-2 text-xs font-semibold text-[#5d4a3d] transition hover:bg-[#fbf6ef] disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() =>
                                  void handleResendProfessionalAssignmentNotification(
                                    client,
                                  )
                                }
                                disabled={
                                  resendingProfessionalEmailId === client.id ||
                                  resendingClientEmailId === client.id ||
                                  cancelingAssignedClientId === client.id
                                }
                              >
                                {resendingProfessionalEmailId === client.id
                                  ? "Envoi..."
                                  : "Renvoyer courriel au professionnel"}
                              </button>
                              <button
                                type="button"
                                className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[#dfd0bf] bg-[#fffdf9] px-3 py-2 text-xs font-semibold text-[#5d4a3d] transition hover:bg-[#fbf6ef] disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() =>
                                  void handleResendClientAssignmentNotification(
                                    client,
                                  )
                                }
                                disabled={
                                  !client.email?.trim() ||
                                  resendingClientEmailId === client.id ||
                                  resendingProfessionalEmailId === client.id ||
                                  cancelingAssignedClientId === client.id
                                }
                              >
                                {resendingClientEmailId === client.id
                                  ? "Envoi..."
                                  : "Renvoyer courriel au client"}
                              </button>
                              <button
                                type="button"
                                className="inline-flex min-h-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() => openCancelAssignmentDialog(client)}
                                disabled={cancelingAssignedClientId === client.id}
                              >
                                Annuler l’assignation
                              </button>
                            </div>
                          </div>

                          {canUseSuperAdminActions && (
                            <div className="mt-4 flex justify-end">
                              <button
                                type="button"
                                className="inline-flex min-h-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() => void handleDeleteAssignedClient(client)}
                                disabled={deletingAssignedClientId === client.id}
                              >
                                {deletingAssignedClientId === client.id
                                  ? "Suppression..."
                                  : "Supprimer l'assignation"}
                              </button>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}

                {assignedClients.length > ASSIGNED_CLIENTS_PAGE_SIZE && (
                  <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      className={buttonClass("secondary")}
                      onClick={() =>
                        setAssignedClientsPage((currentPage) =>
                          Math.max(currentPage - 1, 0),
                        )
                      }
                      disabled={assignedClientsPage === 0}
                    >
                      Précédent
                    </button>
                    <p className="text-center text-sm font-medium text-[#7a6859]">
                      Page {assignedClientsPage + 1} sur {assignedClientsPageCount}
                    </p>
                    <button
                      type="button"
                      className={buttonClass("secondary")}
                      onClick={() =>
                        setAssignedClientsPage((currentPage) =>
                          Math.min(currentPage + 1, assignedClientsPageCount - 1),
                        )
                      }
                      disabled={assignedClientsPage >= assignedClientsPageCount - 1}
                    >
                      Suivant
                    </button>
                  </div>
                )}

              </SectionCard>

              <SectionCard
                title="Historique client"
                description="Timeline récente générée à partir des clients assignés, incluant les anciennes demandes."
              >
                {historicalClients.length === 0 ? (
                  <EmptyState title="Aucun historique client à afficher." />
                ) : !showClientHistory ? (
                  <button
                    type="button"
                    className={buttonClass("secondary")}
                    onClick={() => setShowClientHistory(true)}
                  >
                    Voir l’historique client
                  </button>
                ) : (
                  <div className="space-y-4">
                    {paginatedHistoricalClients.map((client) => (
                      <article
                        key={client.id}
                        className="relative rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4 pl-11"
                      >
                        <span className="absolute left-4 top-5 h-3 w-3 rounded-full border-2 border-[#fffdf9] bg-[#8a5633] shadow-[0_0_0_3px_#eadfd2]" />

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="font-medium text-[#332820]">
                              {getClientName(client)}
                            </h3>
                            <p className="mt-1 text-sm text-[#7a6859]">
                              Assigné le {formatDate(client.assigned_date)}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Badge tone={getServiceStatus(client).tone}>
                              {getServiceStatus(client).label}
                            </Badge>
                          </div>
                        </div>

                        {(client.closure_reason || client.short_comment) && (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {client.closure_reason && (
                              <div className="rounded-xl border border-[#eadfd2] bg-[#fffdf9] p-3">
                                <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                                  Motif de non-prise
                                </p>
                                <p className="mt-1 text-sm text-[#332820]">
                                  {formatText(client.closure_reason)}
                                </p>
                              </div>
                            )}

                            {client.short_comment && (
                              <div className="min-w-0 overflow-hidden rounded-xl border border-[#eadfd2] bg-[#fffdf9] p-3">
                                <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                                  Motif de consultation
                                </p>
                                <p className="mt-1 max-w-full whitespace-pre-wrap break-words text-sm text-[#332820] [overflow-wrap:anywhere]">
                                  {formatText(client.short_comment)}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-[#7a6859]">
                        Page {clientHistoryPage + 1} sur {clientHistoryPageCount}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={buttonClass("secondary")}
                          onClick={() =>
                            setClientHistoryPage((currentPage) =>
                              Math.max(currentPage - 1, 0),
                            )
                          }
                          disabled={clientHistoryPage === 0}
                        >
                          Précédent
                        </button>
                        <button
                          type="button"
                          className={buttonClass("secondary")}
                          onClick={() =>
                            setClientHistoryPage((currentPage) =>
                              Math.min(
                                currentPage + 1,
                                clientHistoryPageCount - 1,
                              ),
                            )
                          }
                          disabled={clientHistoryPage >= clientHistoryPageCount - 1}
                        >
                          Suivant
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Coordonnees professionnelles"
                description="Informations utilisees pour les communications aux clients."
              >
                <dl className="grid gap-4 md:grid-cols-3">
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">
                      Titre professionnel
                    </dt>
                    <dd className="mt-1 text-sm text-[#332820]">
                      {formatText(profile.professional_title)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">
                      Téléphone professionnel
                    </dt>
                    <dd className="mt-1 text-sm text-[#332820]">
                      {formatText(profile.professional_phone)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">
                      Numéro de permis
                    </dt>
                    <dd className="mt-1 text-sm text-[#332820]">
                      {formatText(profile.professional_license_number)}
                    </dd>
                  </div>
                </dl>
              </SectionCard>

              <SectionCard
                title="Demande"
                description="Demande actuelle transmise par le professionnel."
              >
                {displayAssignmentRequest ? (
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-sm font-medium text-[#8a6f5d]">
                        Demandes
                      </dt>
                      <dd className="mt-1 text-sm text-[#332820]">
                        {requestedCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-[#8a6f5d]">
                        Assignations liées
                      </dt>
                      <dd className="mt-1 text-sm text-[#332820]">
                        {assignedCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-[#8a6f5d]">
                        Restants
                      </dt>
                      <dd className="mt-1 text-sm text-[#332820]">
                        {remainingCount}
                      </dd>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-1">
                      <dt className="text-sm font-medium text-[#8a6f5d]">
                        Commentaire demande
                      </dt>
                      <dd className="mt-1 text-sm text-[#332820]">
                        {formatText(displayAssignmentRequest.request_comment)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <EmptyState title="Aucune demande active actuellement." />
                )}
              </SectionCard>

              <SectionCard
                title="Préférences"
                description="Informations de préférence utiles au choix des assignations."
              >
                <dl className="grid gap-4 md:grid-cols-2">
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">
                      Clientèles souhaitées
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">
                      {formatText(profile.pref_client_types)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">
                      Modalités souhaitées
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">
                      {formatText(profile.pref_modalities)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">
                      Types de suivis souhaités
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">
                      {formatText(profile.pref_followup_types)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">
                      Notes / précisions
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">
                      {formatText(profile.pref_notes)}
                    </dd>
                  </div>
                </dl>
              </SectionCard>

              <SectionCard
                title="Gestion"
                description="Modifier les informations non sensibles du profil professionnel existant."
              >
                <form
                  onSubmit={handleSaveProfessionalProfile}
                  className="space-y-4"
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-sm font-medium text-[#5d4a3d]">
                      Nom complet
                      <input
                        type="text"
                        value={professionalProfileForm.full_name}
                        onChange={(event) =>
                          handleProfessionalProfileFormChange(
                            "full_name",
                            event.target.value,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>

                    <label className="block text-sm font-medium text-[#5d4a3d]">
                      Email
                      <input
                        type="email"
                        value={professionalProfileForm.email}
                        onChange={(event) =>
                          handleProfessionalProfileFormChange(
                            "email",
                            event.target.value,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>

                    <label className="block text-sm font-medium text-[#5d4a3d]">
                      Titre professionnel
                      <input
                        type="text"
                        value={professionalProfileForm.professional_title}
                        onChange={(event) =>
                          handleProfessionalProfileFormChange(
                            "professional_title",
                            event.target.value,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>

                    <label className="block text-sm font-medium text-[#5d4a3d]">
                      Téléphone professionnel
                      <input
                        type="tel"
                        value={professionalProfileForm.professional_phone}
                        onChange={(event) =>
                          handleProfessionalProfileFormChange(
                            "professional_phone",
                            event.target.value,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>

                    <label className="block text-sm font-medium text-[#5d4a3d]">
                      Numéro de permis
                      <input
                        type="text"
                        value={
                          professionalProfileForm.professional_license_number
                        }
                        onChange={(event) =>
                          handleProfessionalProfileFormChange(
                            "professional_license_number",
                            event.target.value,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>

                    <label className="block text-sm font-medium text-[#5d4a3d]">
                      Clientèles souhaitées
                      <textarea
                        value={professionalProfileForm.pref_client_types}
                        onChange={(event) =>
                          handleProfessionalProfileFormChange(
                            "pref_client_types",
                            event.target.value,
                          )
                        }
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>

                    <label className="block text-sm font-medium text-[#5d4a3d]">
                      Modalités souhaitées
                      <textarea
                        value={professionalProfileForm.pref_modalities}
                        onChange={(event) =>
                          handleProfessionalProfileFormChange(
                            "pref_modalities",
                            event.target.value,
                          )
                        }
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>

                    <label className="block text-sm font-medium text-[#5d4a3d]">
                      Types de suivis souhaités
                      <textarea
                        value={professionalProfileForm.pref_followup_types}
                        onChange={(event) =>
                          handleProfessionalProfileFormChange(
                            "pref_followup_types",
                            event.target.value,
                          )
                        }
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>

                    <label className="block text-sm font-medium text-[#5d4a3d]">
                      Notes / précisions
                      <textarea
                        value={professionalProfileForm.pref_notes}
                        onChange={(event) =>
                          handleProfessionalProfileFormChange(
                            "pref_notes",
                            event.target.value,
                          )
                        }
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                    </label>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      type="submit"
                      disabled={savingProfessionalProfile}
                      className={buttonClass("primary")}
                    >
                      {savingProfessionalProfile
                        ? "Sauvegarde..."
                        : "Sauvegarder"}
                    </button>

                    {professionalProfileMessage && (
                      <p className="text-sm font-medium text-green-700">
                        {professionalProfileMessage}
                      </p>
                    )}

                    {professionalProfileError && (
                      <p className="text-sm font-medium text-red-700">
                        {professionalProfileError}
                      </p>
                    )}
                  </div>
                </form>
              </SectionCard>
            </div>
          )}
        </div>
      </main>
      {cancelAssignmentClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-[#332820]">
              Annuler cette assignation ?
            </h2>
            <p className="mt-3 text-sm text-[#6c5a4d]">
              Cette action retirera cette assignation des demandes actives.
            </p>
            <p className="mt-1 text-sm text-[#6c5a4d]">
              Le client ne sera pas supprimé.
            </p>

            <label className="mt-5 block text-sm font-medium text-[#5d4a3d]">
              Motif obligatoire
              <select
                value={cancelAssignmentReason}
                onChange={(event) => setCancelAssignmentReason(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
              >
                <option value="">Sélectionner un motif</option>
                {cancelAssignmentReasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>

            {cancelAssignmentReason === "Autre" && (
              <label className="mt-4 block text-sm font-medium text-[#5d4a3d]">
                Préciser le motif
                <textarea
                  value={cancelAssignmentOtherReason}
                  onChange={(event) =>
                    setCancelAssignmentOtherReason(event.target.value)
                  }
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                />
              </label>
            )}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#dfd0bf] bg-white px-4 py-2 text-sm font-semibold text-[#5d4a3d] transition hover:bg-[#fbf6ef] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={closeCancelAssignmentDialog}
                disabled={Boolean(cancelingAssignedClientId)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-300 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void handleCancelAssignment()}
                disabled={Boolean(cancelingAssignedClientId)}
              >
                {cancelingAssignedClientId ? "Annulation..." : "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

