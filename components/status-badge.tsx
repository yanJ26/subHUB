import { adoptionLabels, recommendationLabels, type AdoptionStatus, type Recommendation } from "@/lib/domain";

export function AdoptionBadge({ status }: { status: AdoptionStatus }) {
  return <span className={`status-badge status-${status}`}>{adoptionLabels[status]}</span>;
}

export function RecommendationBadge({ recommendation }: { recommendation: Recommendation }) {
  return <span className={`recommendation recommendation-${recommendation}`}>{recommendationLabels[recommendation]}</span>;
}
