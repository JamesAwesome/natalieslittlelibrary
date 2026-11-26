-- Adds only; old code ignores the new columns, and every row old code writes leaves them null.
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`linked_member_id` text,
	`created_at` integer NOT NULL,
	`linked_at` integer,
	CONSTRAINT `fk_people_created_by_members_id_fk` FOREIGN KEY (`created_by`) REFERENCES `members`(`id`),
	CONSTRAINT `fk_people_linked_member_id_members_id_fk` FOREIGN KEY (`linked_member_id`) REFERENCES `members`(`id`)
);
--> statement-breakpoint
ALTER TABLE `copies` ADD `holder_person_id` text REFERENCES people(id);--> statement-breakpoint
ALTER TABLE `copies` ADD `requested_by` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `copies` ADD `requested_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `subject_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `events` ADD `subject_person_id` text REFERENCES people(id);--> statement-breakpoint
CREATE INDEX `copies_holder_person_id_idx` ON `copies` (`holder_person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `people_creator_name_key_unique` ON `people` (`created_by`,`name_key`);--> statement-breakpoint
CREATE INDEX `people_linked_member_id_idx` ON `people` (`linked_member_id`);