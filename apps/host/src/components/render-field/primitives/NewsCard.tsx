import { useMemo } from "react";
import type {
  NewsFollowingResult,
  NewsItem,
  ServiceDescriptor,
} from "@renderprotocol/protocol-types";
import { ServiceCard } from "./ServiceCard";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";

interface Props {
  service: ServiceDescriptor;
  composition: string;
  data: NewsFollowingResult;
  error?: string | null;
}

export function NewsCard({ service, composition, data, error }: Props) {
  const summary = `${data.items.length} from your feeds`;
  return (
    <ServiceCard
      service={service}
      composition={composition}
      summary={summary}
      error={error}
    >
      <ul className="rows">
        {data.items.map((n) => (
          <NewsRow
            key={n.item_id}
            item={n}
            composition={composition}
            sourceTool={service.tool}
          />
        ))}
      </ul>
    </ServiceCard>
  );
}

interface RowProps {
  item: NewsItem;
  composition: string;
  sourceTool: string;
}

function NewsRow({ item, composition, sourceTool }: RowProps) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "news-item",
        source_tool: sourceTool,
        entity: item.item_id,
      }),
    [composition, sourceTool, item.item_id],
  );

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "news-item",
        source_tool: sourceTool,
        entity: item.item_id,
        display: {
          source: item.source,
          title: item.title,
          topics: item.topics,
        },
      }}
      className="row"
    >
      <div className="row__main">
        <div className="row__title">
          <span className="row__source">{item.source}</span>
          <span className="row__subject">{item.title}</span>
        </div>
        <div className="row__preview">{item.summary}</div>
        {item.topics.length > 0 && (
          <div className="row__tags">
            {item.topics.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </ElementWrapper>
  );
}
