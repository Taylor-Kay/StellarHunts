import React from "react";
import { Flame, Trophy, Star, Zap, Clock, Award } from "lucide-react";

/**
 * UserProfileStatsCard — Issue #908
 *
 * Shows a user's total puzzles solved, current rank with badge, NFT count,
 * streak with flame icon, XP level with progress bar, best solve time, and
 * achievement count badge.
 *
 * Props:
 *   - user: object containing:
 *       name         {string}  — display name
 *       rank         {number}  — numeric leaderboard rank
 *       rankTitle    {string}  — rank label (e.g. "Gold", "Diamond")
 *       puzzlesSolved{number}  — total puzzles solved
 *       nftCount     {number}  — NFT collection size
 *       streak       {number}  — current daily streak (days)
 *       xp           {number}  — current XP points
 *       xpToNext     {number}  — XP needed to reach next level
 *       level        {number}  — current XP level
 *       bestSolveTime{string}  — formatted best solve time (e.g. "1m 23s")
 *       achievements {number}  — total achievements unlocked
 */
const RANK_COLORS = {
  Diamond: "from-cyan-400 to-blue-500",
  Platinum: "from-slate-300 to-slate-500",
  Gold: "from-yellow-400 to-amber-500",
  Silver: "from-gray-300 to-gray-500",
  Bronze: "from-orange-400 to-amber-700",
};

const RankBadge = ({ rank, rankTitle }) => {
  const gradient = RANK_COLORS[rankTitle] || "from-purple-400 to-pink-400";
  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r ${gradient} text-white text-sm font-bold shadow`}>
      <Trophy className="w-4 h-4" />
      <span>#{rank}</span>
      {rankTitle && <span className="opacity-90">{rankTitle}</span>}
    </div>
  );
};

const StatItem = ({ icon: Icon, label, value, iconClass = "text-purple-400" }) => (
  <div className="flex flex-col items-center gap-1 px-4 py-3 backdrop-blur-sm bg-white/5 border border-white/10 rounded-lg">
    <Icon className={`w-5 h-5 ${iconClass}`} />
    <span className="text-xl font-bold text-white">{value}</span>
    <span className="text-xs text-gray-400">{label}</span>
  </div>
);

const XpProgressBar = ({ xp, xpToNext, level }) => {
  const pct = xpToNext > 0 ? Math.min(100, Math.round((xp / xpToNext) * 100)) : 100;
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-semibold text-white flex items-center gap-1">
          <Zap className="w-4 h-4 text-yellow-400" />
          Level {level}
        </span>
        <span className="text-xs text-gray-400">
          {xp.toLocaleString()} / {xpToNext.toLocaleString()} XP
        </span>
      </div>
      <div className="w-full h-3 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`XP progress: ${pct}%`}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1 text-right">{pct}% to Level {level + 1}</p>
    </div>
  );
};

const UserProfileStatsCard = ({ user }) => {
  if (!user) return null;

  const {
    name,
    rank,
    rankTitle,
    puzzlesSolved = 0,
    nftCount = 0,
    streak = 0,
    xp = 0,
    xpToNext = 1000,
    level = 1,
    bestSolveTime = "—",
    achievements = 0,
  } = user;

  return (
    <div className="relative group w-full max-w-lg">
      {/* Hover glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-purple-500/0 via-purple-500/10 to-pink-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl" />

      <div className="relative p-6 backdrop-blur-sm bg-white/5 border border-white/10 rounded-xl flex flex-col gap-5">

        {/* Header: name + rank badge + achievement badge */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">{name}</h2>
            <div className="mt-1">
              <RankBadge rank={rank} rankTitle={rankTitle} />
            </div>
          </div>

          {/* Achievement count badge */}
          <div className="flex items-center gap-2 px-3 py-2 bg-white/10 border border-white/20 rounded-lg">
            <Award className="w-5 h-5 text-yellow-400" />
            <span className="text-white font-bold">{achievements}</span>
            <span className="text-xs text-gray-400">Achievements</span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatItem
            icon={Trophy}
            label="Puzzles Solved"
            value={puzzlesSolved.toLocaleString()}
            iconClass="text-purple-400"
          />
          <StatItem
            icon={Star}
            label="NFTs Owned"
            value={nftCount.toLocaleString()}
            iconClass="text-pink-400"
          />
          <StatItem
            icon={Flame}
            label="Day Streak"
            value={streak > 0 ? `${streak} 🔥` : "0"}
            iconClass="text-orange-400"
          />
          <StatItem
            icon={Clock}
            label="Best Time"
            value={bestSolveTime}
            iconClass="text-green-400"
          />
        </div>

        {/* XP / Level progress bar */}
        <XpProgressBar xp={xp} xpToNext={xpToNext} level={level} />
      </div>
    </div>
  );
};

export default UserProfileStatsCard;
