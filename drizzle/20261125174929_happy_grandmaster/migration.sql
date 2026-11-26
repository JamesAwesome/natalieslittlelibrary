CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_collections_owner_id_members_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`)
);
--> statement-breakpoint
ALTER TABLE `copies` ADD `collection_id` text REFERENCES collections(id);--> statement-breakpoint
ALTER TABLE `copies` ADD `import_isbn` text;--> statement-breakpoint
CREATE UNIQUE INDEX `collections_owner_name_key_unique` ON `collections` (`owner_id`,`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `collections_one_default` ON `collections` (`owner_id`) WHERE "collections"."is_default" = 1;--> statement-breakpoint
CREATE INDEX `copies_collection_id_idx` ON `copies` (`collection_id`);--> statement-breakpoint
INSERT INTO `collections` (`id`, `owner_id`, `name`, `name_key`, `is_default`, `created_at`)
  SELECT lower(hex(randomblob(16))), `owner_id`, 'Home library', 'home library', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM (SELECT DISTINCT `owner_id` FROM `copies` WHERE `owner_id` IS NOT NULL);--> statement-breakpoint
UPDATE `copies` SET `collection_id` = (SELECT `id` FROM `collections` k WHERE k.`owner_id` = `copies`.`owner_id` AND k.`is_default` = 1)
  WHERE `owner_id` IS NOT NULL AND `collection_id` IS NULL;
