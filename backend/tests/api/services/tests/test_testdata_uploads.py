"""What is in flight in a test's Test Data, and what did not land (TDATA-14, TDATA-15)."""

from unittest.mock import patch

import pytest

from wavecore.api.exceptions import ConflictException, NotFoundException
from wavecore.api.services.tests import testdata_uploads
from wavecore.api.services.workbench import ownership

TEST_ID = "test-1"
OTHER_TEST_ID = "test-2"
HOLDER = "holder-session"
STARTER = "starter-session"


def start(
    upload_id: str = "u1",
    *,
    test_id: str = TEST_ID,
    folder: str = "",
    name: str = "alpha.txt",
    session: str = STARTER,
    total_bytes: int = 100,
    replace: bool = False,
) -> testdata_uploads.Upload:
    return testdata_uploads.start(
        test_id,
        upload_id,
        folder=folder,
        name=name,
        path=f"{folder}/{name}" if folder else name,
        total_bytes=total_bytes,
        session=session,
        replace=replace,
    )


def interrupt(upload_id: str = "u1", *, name: str = "alpha.txt", reason: str = "gone") -> None:
    testdata_uploads.interrupt(
        TEST_ID,
        upload_id,
        folder="",
        name=name,
        path=name,
        reason=reason,
        replace=False,
    )


@pytest.fixture(autouse=True)
def _clean() -> None:
    testdata_uploads.clear()
    ownership.clear()


class TestTopic:
    """One topic per test carries everything about that test's files."""

    def test_the_topic_names_the_test(self) -> None:
        assert testdata_uploads.topic_for(TEST_ID) == "testdata:test-1"


class TestSnapshot:
    """What a session joining late is told."""

    def test_an_untouched_test_has_nothing_in_flight(self) -> None:
        assert testdata_uploads.snapshot(TEST_ID) == {"uploads": [], "interruptions": []}

    def test_a_started_upload_is_listed_with_its_destination_and_size(self) -> None:
        start(folder="inputs", name="users.csv", total_bytes=2048)

        listed = testdata_uploads.snapshot(TEST_ID)["uploads"]

        assert listed == [
            {
                "id": "u1",
                "folder": "inputs",
                "name": "users.csv",
                "path": "inputs/users.csv",
                "total_bytes": 2048,
                "loaded_bytes": 0,
                "eta_seconds": None,
                "started_at": listed[0]["started_at"],
                "session": STARTER,
            }
        ]

    def test_the_start_time_is_epoch_milliseconds(self) -> None:
        upload = start()

        assert upload.started_at > 1_600_000_000_000

    def test_an_interruption_is_listed_with_its_reason(self) -> None:
        interrupt(reason="File already exists: alpha.txt")

        listed = testdata_uploads.snapshot(TEST_ID)["interruptions"]

        assert listed == [
            {
                "id": "u1",
                "folder": "",
                "name": "alpha.txt",
                "path": "alpha.txt",
                "reason": "File already exists: alpha.txt",
                "replace": False,
                "at": listed[0]["at"],
            }
        ]

    def test_one_test_never_sees_another_test_uploads(self) -> None:
        start(test_id=OTHER_TEST_ID)

        assert testdata_uploads.snapshot(TEST_ID)["uploads"] == []


class TestEta:
    """The server works the time left out once, so every session shows the same one."""

    def test_nothing_sent_yet_has_no_rate_to_measure(self) -> None:
        start(total_bytes=1000)

        assert testdata_uploads.snapshot(TEST_ID)["uploads"][0]["eta_seconds"] is None

    def test_a_size_the_client_never_declared_has_no_eta(self) -> None:
        upload = start(total_bytes=0)
        testdata_uploads.advance(upload, 500)

        assert testdata_uploads.snapshot(TEST_ID)["uploads"][0]["eta_seconds"] is None

    def test_the_rate_so_far_gives_the_seconds_left(self) -> None:
        upload = start(total_bytes=1000)
        upload.started_at -= 4000
        testdata_uploads.advance(upload, 200)

        # 200 bytes in 4 seconds is 50 a second; 800 left is 16 seconds.
        assert testdata_uploads.snapshot(TEST_ID)["uploads"][0]["eta_seconds"] == 16

    def test_a_file_fully_received_has_no_time_left(self) -> None:
        upload = start(total_bytes=1000)
        upload.started_at -= 4000
        testdata_uploads.advance(upload, 1000)

        assert testdata_uploads.snapshot(TEST_ID)["uploads"][0]["eta_seconds"] == 0


class TestProgress:
    """Bytes in, and how often that is broadcast."""

    def test_bytes_accumulate_on_the_record(self) -> None:
        upload = start()

        testdata_uploads.advance(upload, 30)
        testdata_uploads.advance(upload, 12)

        assert upload.loaded_bytes == 42

    def test_the_first_chunk_is_announced(self) -> None:
        upload = start()

        with patch.object(testdata_uploads.events, "emit") as emit:
            testdata_uploads.advance(upload, 30)

        emit.assert_called_once()

    def test_a_chunk_inside_the_interval_is_not_announced_again(self) -> None:
        upload = start()
        testdata_uploads.advance(upload, 30)

        with patch.object(testdata_uploads.events, "emit") as emit:
            testdata_uploads.advance(upload, 30)

        emit.assert_not_called()
        assert upload.loaded_bytes == 60


class TestFinish:
    """A file that landed leaves nothing behind."""

    def test_the_row_goes(self) -> None:
        upload = start()

        testdata_uploads.finish(upload)

        assert testdata_uploads.snapshot(TEST_ID)["uploads"] == []

    def test_an_earlier_notice_for_the_same_file_goes_with_it(self) -> None:
        interrupt("old", name="alpha.txt")
        upload = start("new", name="alpha.txt")

        testdata_uploads.finish(upload)

        assert testdata_uploads.snapshot(TEST_ID)["interruptions"] == []

    def test_a_notice_about_a_different_file_stays(self) -> None:
        interrupt("old", name="beta.txt")
        upload = start("new", name="alpha.txt")

        testdata_uploads.finish(upload)

        assert [
            record["name"] for record in testdata_uploads.snapshot(TEST_ID)["interruptions"]
        ] == ["beta.txt"]

    def test_the_listing_change_is_announced_too(self) -> None:
        upload = start()

        with patch.object(testdata_uploads.events, "emit") as emit:
            testdata_uploads.finish(upload)

        assert [call.args[1]["event"] for call in emit.call_args_list] == [
            "uploads_changed",
            "entries_changed",
        ]


class TestInterrupt:
    """A file that did not land leaves a notice that outlives the tab."""

    def test_the_notice_replaces_the_row(self) -> None:
        upload = start()

        testdata_uploads.interrupt(
            TEST_ID,
            upload.id,
            folder="",
            name="alpha.txt",
            path="alpha.txt",
            reason="Upload ended before the file was complete",
            replace=False,
        )

        snapshot = testdata_uploads.snapshot(TEST_ID)
        assert snapshot["uploads"] == []
        assert snapshot["interruptions"][0]["reason"] == "Upload ended before the file was complete"

    def test_a_refusal_before_the_first_byte_still_leaves_a_notice(self) -> None:
        interrupt(reason="Folder already exists: notes")

        assert testdata_uploads.snapshot(TEST_ID)["interruptions"][0]["name"] == "alpha.txt"

    def test_the_replace_answer_is_kept_so_a_retry_can_repeat_it(self) -> None:
        testdata_uploads.interrupt(
            TEST_ID,
            "u1",
            folder="",
            name="alpha.txt",
            path="alpha.txt",
            reason="gone",
            replace=True,
        )

        assert testdata_uploads.snapshot(TEST_ID)["interruptions"][0]["replace"] is True


class TestCancel:
    """Who may stop an upload (TDATA-15)."""

    def test_the_session_that_started_it_may(self) -> None:
        upload = start()

        testdata_uploads.cancel(TEST_ID, "u1", STARTER)

        assert testdata_uploads.is_canceled(upload) is True

    def test_the_session_holding_the_test_may(self) -> None:
        upload = start()
        ownership.claim(HOLDER, "Holder")

        testdata_uploads.cancel(TEST_ID, "u1", HOLDER)

        assert testdata_uploads.is_canceled(upload) is True

    def test_every_session_is_told_at_once_rather_than_when_the_transfer_stops(self) -> None:
        start()

        with patch.object(testdata_uploads.events, "emit") as emit:
            testdata_uploads.cancel(TEST_ID, "u1", STARTER)

        assert [call.args[1]["event"] for call in emit.call_args_list] == [
            "upload_canceled",
            "uploads_changed",
        ]
        assert testdata_uploads.snapshot(TEST_ID)["uploads"] == []

    def test_the_request_noticing_later_says_nothing_a_second_time(self) -> None:
        upload = start()
        testdata_uploads.cancel(TEST_ID, "u1", STARTER)

        with patch.object(testdata_uploads.events, "emit") as emit:
            testdata_uploads.abandon(upload)

        emit.assert_not_called()

    def test_a_third_session_may_not(self) -> None:
        upload = start()
        ownership.claim(HOLDER, "Holder")

        with pytest.raises(
            ConflictException,
            match=r"^Only the session holding the test, or the one that started it, "
            r"can cancel an upload$",
        ):
            testdata_uploads.cancel(TEST_ID, "u1", "someone-else")

        assert testdata_uploads.is_canceled(upload) is False

    def test_a_session_that_is_nobody_may_not_when_no_one_holds_the_test(self) -> None:
        start()

        with pytest.raises(ConflictException):
            testdata_uploads.cancel(TEST_ID, "u1", "someone-else")

    def test_an_unknown_upload_is_not_found(self) -> None:
        with pytest.raises(NotFoundException, match=r"^No such upload$"):
            testdata_uploads.cancel(TEST_ID, "nothing", STARTER)

    def test_the_canceled_request_is_told_which_file_it_was(self) -> None:
        upload = start(folder="inputs", name="users.csv")

        error = testdata_uploads.canceled_error(upload)

        assert error.message == "Upload canceled: inputs/users.csv"
        assert error.status_code == 409


class TestAbandon:
    """A cancellation is disposable: broadcast once, never stored (TDATA-14)."""

    def test_the_row_goes_and_nothing_is_kept(self) -> None:
        upload = start()

        testdata_uploads.abandon(upload)

        assert testdata_uploads.snapshot(TEST_ID) == {"uploads": [], "interruptions": []}

    def test_the_sessions_watching_are_told_which_file_it_was(self) -> None:
        upload = start(folder="inputs", name="users.csv")

        with patch.object(testdata_uploads.events, "emit") as emit:
            testdata_uploads.abandon(upload)

        assert emit.call_args_list[0].args[1] == {
            "event": "upload_canceled",
            "id": "u1",
            "name": "users.csv",
            "path": "inputs/users.csv",
        }


class TestDismiss:
    """Clearing a notice."""

    def test_the_notice_goes(self) -> None:
        interrupt()

        testdata_uploads.dismiss(TEST_ID, "u1")

        assert testdata_uploads.snapshot(TEST_ID)["interruptions"] == []

    def test_an_unknown_notice_is_not_found(self) -> None:
        with pytest.raises(NotFoundException, match=r"^No such upload$"):
            testdata_uploads.dismiss(TEST_ID, "nothing")

    def test_a_retry_clears_its_own_notice_without_a_frame_of_its_own(self) -> None:
        interrupt()

        with patch.object(testdata_uploads.events, "emit") as emit:
            testdata_uploads.drop_interruption(TEST_ID, "u1")

        emit.assert_not_called()
        assert testdata_uploads.snapshot(TEST_ID)["interruptions"] == []

    def test_dropping_a_notice_that_is_not_there_is_not_an_error(self) -> None:
        testdata_uploads.drop_interruption(TEST_ID, "nothing")

        assert testdata_uploads.snapshot(TEST_ID)["interruptions"] == []


class TestSweepProtection:
    """The orphan sweep must leave a live upload's own file alone (TDATA-18)."""

    def test_a_live_upload_owns_its_path(self) -> None:
        start(folder="inputs", name="users.csv")

        assert testdata_uploads.in_progress_paths(TEST_ID) == {"inputs/users.csv"}

    def test_a_finished_upload_owns_nothing(self) -> None:
        upload = start()
        testdata_uploads.finish(upload)

        assert testdata_uploads.in_progress_paths(TEST_ID) == set()


class TestCascade:
    """Upload state travels with the test."""

    def test_deleting_the_test_drops_its_rows_and_notices(self) -> None:
        start()
        interrupt("u2", name="beta.txt")

        testdata_uploads.clear_for_test(TEST_ID)

        assert testdata_uploads.snapshot(TEST_ID) == {"uploads": [], "interruptions": []}

    def test_deleting_one_test_leaves_another_alone(self) -> None:
        start(test_id=OTHER_TEST_ID)

        testdata_uploads.clear_for_test(TEST_ID)

        assert len(testdata_uploads.snapshot(OTHER_TEST_ID)["uploads"]) == 1

    def test_the_zone_reset_drops_everything(self) -> None:
        start(test_id=OTHER_TEST_ID)
        interrupt()

        testdata_uploads.clear()

        assert testdata_uploads.snapshot(OTHER_TEST_ID)["uploads"] == []
        assert testdata_uploads.snapshot(TEST_ID)["interruptions"] == []


class TestEntriesAnnouncement:
    """A change to the listing reaches every session watching (TDATA-14)."""

    def test_the_event_names_the_test_topic(self) -> None:
        with patch.object(testdata_uploads.events, "emit") as emit:
            testdata_uploads.announce_entries(TEST_ID)

        emit.assert_called_once_with("testdata:test-1", {"event": "entries_changed"})
