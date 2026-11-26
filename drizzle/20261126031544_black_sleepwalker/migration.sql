-- Fails if a copy already has two labels; none can today (every bind is guarded on the copy having none).
ALTER TABLE `labels` ADD `sheet_id` text;--> statement-breakpoint
ALTER TABLE `labels` ADD `retired_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `labels_one_live_per_copy` ON `labels` (`copy_id`) WHERE "labels"."retired_at" is null and "labels"."copy_id" is not null;