#!/usr/bin/env bash
# Проверка резервной копии восстановлением: bash scripts/restore-check.sh <папка с roles.sql, schema.sql, data.sql>
# Поднимает пустую Supabase в Docker (без миграций проекта — как новый проект в облаке), восстанавливает копию
# по процедуре Supabase и сверяет число строк каждой таблицы с копией. Восстанавливает суперпользователь
# проверочной базы: в выгрузке ролей есть GRANT SET ON PARAMETER.
# Локальная база проекта должна быть остановлена (npm run db:stop): порты те же.
set -euo pipefail

dir=$(cd "$1" && pwd)
repo=$(cd "$(dirname "$0")/.." && pwd)
supabase="$repo/node_modules/.bin/supabase"
work=$(mktemp -d)
project=sauda-restore-check
trap '"$supabase" stop --no-backup --workdir "$work" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

mkdir -p "$work/supabase"
cp -r "$repo/supabase/templates" "$work/supabase/"
sed "s/^project_id = .*/project_id = \"$project\"/" "$repo/supabase/config.toml" > "$work/supabase/config.toml"
"$supabase" start --workdir "$work" -x realtime,imgproxy,edge-runtime,logflare,vector,supavisor,studio

db="supabase_db_$project"
psql() { docker exec -i "$db" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo 'Восстановление…'
{
  cat "$dir/roles.sql" "$dir/schema.sql"
  echo 'SET session_replication_role = replica;'
  cat "$dir/data.sql"
} | psql --single-transaction >/dev/null

# ожидаемое число строк — по блокам COPY в выгрузке; таблицы без строк в копии не попадают
expected=$(awk '/^COPY /{t=$2; n=0; next} /^\\\.$/{if (t) print t, n; t=""; next} t{n++}' "$dir/data.sql" | sort)
actual=$(echo "$expected" | while read -r table _; do
  # </dev/null: иначе docker exec -i забирает строки, которые читает цикл
  [ -n "$table" ] && echo "$table $(psql -tA -c "select count(*) from $table" </dev/null)"
done | sort)

if [ "$expected" != "$actual" ]; then
  echo '::error::Копия восстановилась не полностью'
  diff <(echo "$expected") <(echo "$actual") || true
  exit 1
fi
tables=$(echo "$expected" | grep -c . || true)
rows=$(echo "$expected" | awk '{s+=$2} END {print s+0}')
echo "Копия восстановлена: таблиц $tables, строк $rows — совпадает с выгрузкой"
