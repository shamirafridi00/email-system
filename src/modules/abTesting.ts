import { db } from "../database";
import { logInfo } from "./logger";

interface ABTestRow {
  id: number;
  campaign_id: number;
  step_number: number;
  name: string;
  status: string;
  variant_a_subject: string;
  variant_b_subject: string;
  variant_a_sent: number;
  variant_b_sent: number;
  variant_a_opened: number;
  variant_b_opened: number;
  variant_a_replied: number;
  variant_b_replied: number;
  winner: string | null;
  winner_declared_at: string | null;
  min_sample_size: number;
  confidence_threshold: number;
  auto_declare: number;
  created_at: string;
}

export function getActiveTest(campaign_id: number, step_number: number): ABTestRow | null {
  return db
    .query<ABTestRow, [number, number]>(
      "SELECT * FROM ab_tests WHERE campaign_id = ? AND step_number = ? AND status = 'running' LIMIT 1"
    )
    .get(campaign_id, step_number);
}

export function assignVariant(ab_test_id: number): "a" | "b" {
  const row = db
    .query<{ variant_a_sent: number; variant_b_sent: number }, [number]>(
      "SELECT variant_a_sent, variant_b_sent FROM ab_tests WHERE id = ?"
    )
    .get(ab_test_id);
  if (!row) return "a";
  return row.variant_b_sent < row.variant_a_sent ? "b" : "a";
}

export function recordOpen(ab_test_id: number, variant: string): void {
  const col = variant === "b" ? "variant_b_opened" : "variant_a_opened";
  db.run(`UPDATE ab_tests SET ${col} = ${col} + 1 WHERE id = ?`, [ab_test_id]);
}

export function recordReply(ab_test_id: number, variant: string): void {
  const col = variant === "b" ? "variant_b_replied" : "variant_a_replied";
  db.run(`UPDATE ab_tests SET ${col} = ${col} + 1 WHERE id = ?`, [ab_test_id]);
}

export function checkForWinner(ab_test_id: number): string | null {
  const test = db
    .query<ABTestRow, [number]>("SELECT * FROM ab_tests WHERE id = ?")
    .get(ab_test_id);
  if (!test || !test.auto_declare || test.status !== "running") return null;

  const { variant_a_sent, variant_b_sent, variant_a_opened, variant_b_opened, min_sample_size, confidence_threshold } = test;

  if (variant_a_sent < min_sample_size || variant_b_sent < min_sample_size) return null;

  const rateA = variant_a_sent > 0 ? variant_a_opened / variant_a_sent : 0;
  const rateB = variant_b_sent > 0 ? variant_b_opened / variant_b_sent : 0;
  const diff = Math.abs(rateA - rateB);

  if (diff < confidence_threshold) return null;

  const winner = rateA >= rateB ? "a" : "b";
  const now = new Date().toISOString();

  db.run(
    "UPDATE ab_tests SET winner = ?, status = 'winner_declared', winner_declared_at = ? WHERE id = ?",
    [winner, now, ab_test_id]
  );

  logInfo("system", `AB test winner declared: test ${ab_test_id}, winner variant ${winner}`, {
    ab_test_id,
    winner,
    rate_a: rateA,
    rate_b: rateB,
  }).catch(() => {});

  return winner;
}

export function applyWinner(ab_test_id: number): string | null {
  const test = db
    .query<ABTestRow, [number]>("SELECT * FROM ab_tests WHERE id = ?")
    .get(ab_test_id);
  if (!test || !test.winner) return null;

  const winningSubject = test.winner === "b" ? test.variant_b_subject : test.variant_a_subject;

  db.run(
    "UPDATE sequence_steps SET subject = ? WHERE campaign_id = ? AND step_number = ?",
    [winningSubject, test.campaign_id, test.step_number]
  );

  db.run(
    "UPDATE ab_tests SET status = 'winner_declared' WHERE id = ?",
    [ab_test_id]
  );

  return winningSubject;
}

export async function getTestStats(ab_test_id: number): Promise<Record<string, unknown> | null> {
  const test = db
    .query<ABTestRow & { campaign_name: string }, [number]>(
      `SELECT t.*, c.name as campaign_name
       FROM ab_tests t
       LEFT JOIN campaigns c ON c.id = t.campaign_id
       WHERE t.id = ?`
    )
    .get(ab_test_id);
  if (!test) return null;

  const rateA = test.variant_a_sent > 0 ? test.variant_a_opened / test.variant_a_sent : 0;
  const rateB = test.variant_b_sent > 0 ? test.variant_b_opened / test.variant_b_sent : 0;
  const replyRateA = test.variant_a_sent > 0 ? test.variant_a_replied / test.variant_a_sent : 0;
  const replyRateB = test.variant_b_sent > 0 ? test.variant_b_replied / test.variant_b_sent : 0;

  const sampleReached = test.variant_a_sent >= test.min_sample_size && test.variant_b_sent >= test.min_sample_size;
  const diff = Math.abs(rateA - rateB);
  const currentLeader = rateA > rateB ? "a" : rateB > rateA ? "b" : "tied";

  let recommendation: string;
  if (test.status === "winner_declared") {
    const w = test.winner === "b" ? "Version B" : "Version A";
    recommendation = `${w} has been declared the winner and applied to the sequence.`;
  } else if (test.status === "stopped") {
    recommendation = "This test was stopped manually. No winner was applied.";
  } else if (!sampleReached) {
    const needed = Math.max(test.min_sample_size - test.variant_a_sent, test.min_sample_size - test.variant_b_sent);
    recommendation = `Need ${needed} more sends per variant before a winner can be declared.`;
  } else if (diff < test.confidence_threshold) {
    recommendation = `Sample size reached but open rate difference (${(diff * 100).toFixed(1)}%) is below the ${(test.confidence_threshold * 100).toFixed(0)}% threshold. Continue running or declare manually.`;
  } else {
    const leader = currentLeader === "b" ? "Version B" : "Version A";
    recommendation = `${leader} is leading by ${(diff * 100).toFixed(1)}%. Ready to declare a winner.`;
  }

  return {
    ...test,
    variant_a: {
      sent: test.variant_a_sent,
      opened: test.variant_a_opened,
      open_rate: rateA,
      replied: test.variant_a_replied,
      reply_rate: replyRateA,
    },
    variant_b: {
      sent: test.variant_b_sent,
      opened: test.variant_b_opened,
      open_rate: rateB,
      replied: test.variant_b_replied,
      reply_rate: replyRateB,
    },
    current_leader: currentLeader,
    sample_size_reached: sampleReached,
    winner_declared: test.status === "winner_declared",
    winner: test.winner,
    recommendation,
  };
}
